import { FFmpeg } from '@ffmpeg/ffmpeg';
import { FFFSType, type LogEvent, type ProgressEvent } from '@ffmpeg/ffmpeg';
import {
  buildExtractionPlan,
  type ExtractionPlan,
  type OutputFormatId,
} from '../domain/audioFormats';
import {
  parseProbeLogs,
  parseProgressTimeSec,
  type AudioTrack,
  type ProbeResult,
} from '../domain/probeParser';

export type EngineErrorCode =
  | 'cancelled'
  | 'offline_engine_missing'
  | 'engine_load_failed'
  | 'unreadable_file'
  | 'no_audio_track'
  | 'extraction_failed';

export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
  }
}

export interface ExtractedAudio {
  readonly blob: Blob;
  readonly sizeBytes: number;
  readonly plan: ExtractionPlan;
  readonly elapsedMs: number;
}

export interface AudioExtractorEngine {
  isLoaded(): boolean;
  load(onProgress?: (ratio: number) => void): Promise<void>;
  inspect(file: File): Promise<ProbeResult>;
  extract(params: {
    readonly file: File;
    readonly track: AudioTrack;
    readonly totalTracks: number;
    readonly durationSec: number | null;
    readonly format: OutputFormatId;
    readonly onProgress?: (ratio: number) => void;
  }): Promise<ExtractedAudio>;
  cancel(): void;
  dispose(): void;
}

const INPUT_MOUNT_DIR = '/input';
const VIDEO_STREAM_RE = /Stream\s+#\d+:\d+[^:]*:\s*Video:/;
const CORRUPT_OR_INVALID_RE =
  /Invalid data found|moov atom not found|could not find codec|Error opening input/i;

function safeInputVirtualName(fileName: string): string {
  const extMatch = /\.([a-zA-Z0-9]{1,8})$/.exec(fileName.trim());
  const ext = extMatch?.[1]?.toLowerCase() ?? 'bin';
  return `source.${ext}`;
}

function getCoreAssetUrls(): { coreURL: string; wasmURL: string } {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const origin = window.location.origin;
  return {
    coreURL: new URL(`${normalizedBase}ffmpeg/ffmpeg-core.js`, origin).href,
    wasmURL: new URL(`${normalizedBase}ffmpeg/ffmpeg-core.wasm`, origin).href,
  };
}

async function fetchWithProgress(
  url: string,
  signal: AbortSignal,
  onProgress?: (ratio: number) => void,
): Promise<string> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} loading ${url}`);
  }

  const contentLength = Number(response.headers.get('content-length') || '0');
  const contentType = response.headers.get('content-type') || 'application/wasm';

  if (!response.body || !contentLength || !onProgress) {
    const blob = await response.blob();
    onProgress?.(1);
    return URL.createObjectURL(new Blob([blob], { type: contentType }));
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      const copy = new Uint8Array(new ArrayBuffer(value.byteLength));
      copy.set(value);
      chunks.push(copy);
      loaded += value.byteLength;
      onProgress(Math.min(0.99, loaded / contentLength));
    }
  }

  onProgress(1);
  return URL.createObjectURL(new Blob(chunks, { type: contentType }));
}

export class FfmpegWasmEngine implements AudioExtractorEngine {
  private ffmpeg = new FFmpeg();
  private loadPromise: Promise<void> | null = null;
  private loadAbort: AbortController | null = null;
  private cancelled = false;
  private mountedDir = false;
  private memfsInputPath: string | null = null;

  isLoaded(): boolean {
    return this.ffmpeg.loaded;
  }

  async load(onProgress?: (ratio: number) => void): Promise<void> {
    if (this.ffmpeg.loaded) {
      onProgress?.(1);
      return;
    }
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.cancelled = false;
    const abortController = new AbortController();
    this.loadAbort = abortController;
    const { coreURL, wasmURL } = getCoreAssetUrls();

    this.loadPromise = (async () => {
      let wasmBlobUrl: string | null = null;
      try {
        wasmBlobUrl = await fetchWithProgress(wasmURL, abortController.signal, onProgress);
        if (this.cancelled) {
          throw new EngineError('cancelled', 'Cancelled.');
        }
        await this.ffmpeg.load({
          coreURL,
          wasmURL: wasmBlobUrl,
        });
      } catch (err) {
        if (err instanceof EngineError) throw err;
        if (this.cancelled || abortController.signal.aborted) {
          throw new EngineError('cancelled', 'Cancelled.');
        }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          throw new EngineError(
            'offline_engine_missing',
            'Connect once to cache the audio engine. After that, the app works offline.',
          );
        }
        throw new EngineError(
          'engine_load_failed',
          'Could not load the audio engine. Check your connection and try again.',
        );
      } finally {
        if (wasmBlobUrl) {
          URL.revokeObjectURL(wasmBlobUrl);
        }
        if (this.loadAbort === abortController) {
          this.loadAbort = null;
        }
        this.loadPromise = null;
      }
    })();

    return this.loadPromise;
  }

  private async mountInputFile(file: File): Promise<string> {
    await this.cleanupInput();
    const virtualName = safeInputVirtualName(file.name);

    try {
      await this.ffmpeg.createDir(INPUT_MOUNT_DIR);
      const mounted = await this.ffmpeg.mount(
        FFFSType.WORKERFS,
        { blobs: [{ name: virtualName, data: file }] },
        INPUT_MOUNT_DIR,
      );
      if (mounted) {
        this.mountedDir = true;
        return `${INPUT_MOUNT_DIR}/${virtualName}`;
      }
      await this.safeDeleteDir(INPUT_MOUNT_DIR);
    } catch {
      await this.safeDeleteDir(INPUT_MOUNT_DIR);
    }

    // Fallback when WORKERFS is unavailable: write directly to MEMFS
    const memPath = `/${virtualName}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await this.ffmpeg.writeFile(memPath, bytes);
    this.memfsInputPath = memPath;
    return memPath;
  }

  private async cleanupInput(): Promise<void> {
    if (!this.ffmpeg.loaded) {
      this.mountedDir = false;
      this.memfsInputPath = null;
      return;
    }

    if (this.mountedDir) {
      try {
        await this.ffmpeg.unmount(INPUT_MOUNT_DIR);
      } catch {
        // Ignore if already unmounted
      }
      await this.safeDeleteDir(INPUT_MOUNT_DIR);
      this.mountedDir = false;
    }

    if (this.memfsInputPath) {
      try {
        await this.ffmpeg.deleteFile(this.memfsInputPath);
      } catch {
        // Ignore if already removed
      }
      this.memfsInputPath = null;
    }
  }

  private async safeDeleteDir(path: string): Promise<void> {
    try {
      await this.ffmpeg.deleteDir(path);
    } catch {
      // Directory may not exist or already removed
    }
  }

  private async safeDeleteFile(path: string): Promise<void> {
    if (!this.ffmpeg.loaded) return;
    try {
      await this.ffmpeg.deleteFile(path);
    } catch {
      // Output file may not have been created
    }
  }

  async inspect(file: File): Promise<ProbeResult> {
    if (file.size === 0) {
      throw new EngineError('unreadable_file', 'This file is empty. Choose another video.');
    }

    await this.load();
    this.cancelled = false;

    const logs: string[] = [];
    const onLog = ({ message }: LogEvent) => {
      logs.push(message);
    };

    this.ffmpeg.on('log', onLog);

    try {
      const inputPath = await this.mountInputFile(file);
      // FFmpeg prints all container/stream details when invoked with only -i
      await this.ffmpeg.exec(['-hide_banner', '-i', inputPath]);
      const probe = parseProbeLogs(logs);

      if (probe.tracks.length === 0) {
        const hasVideoStream = logs.some((line) => VIDEO_STREAM_RE.test(line));
        const looksCorrupt = logs.some((line) => CORRUPT_OR_INVALID_RE.test(line));

        if (hasVideoStream) {
          throw new EngineError(
            'no_audio_track',
            'This video has no audio track to extract.',
          );
        }
        if (looksCorrupt) {
          throw new EngineError(
            'unreadable_file',
            'Could not read this file. It may be damaged or an unsupported format.',
          );
        }
        throw new EngineError(
          'no_audio_track',
          'No audio track was found in this file.',
        );
      }

      return probe;
    } catch (err) {
      if (err instanceof EngineError) throw err;
      if (this.cancelled) {
        throw new EngineError('cancelled', 'Cancelled.');
      }
      throw new EngineError(
        'unreadable_file',
        'Could not inspect this video. Try a different file.',
      );
    } finally {
      this.ffmpeg.off('log', onLog);
      await this.cleanupInput();
    }
  }

  async extract(params: {
    readonly file: File;
    readonly track: AudioTrack;
    readonly totalTracks: number;
    readonly durationSec: number | null;
    readonly format: OutputFormatId;
    readonly onProgress?: (ratio: number) => void;
  }): Promise<ExtractedAudio> {
    const { file, track, totalTracks, durationSec, format, onProgress } = params;
    await this.load();
    this.cancelled = false;

    const startedAt = performance.now();
    let plan: ExtractionPlan | null = null;
    let lastProgress = 0;

    const emitProgress = (raw: number) => {
      if (!Number.isFinite(raw)) return;
      const clamped = Math.max(0, Math.min(0.99, raw));
      if (clamped > lastProgress) {
        lastProgress = clamped;
        onProgress?.(clamped);
      }
    };

    const logs: string[] = [];
    const onLog = ({ message }: LogEvent) => {
      logs.push(message);
      if (durationSec && durationSec > 0) {
        const timeSec = parseProgressTimeSec(message);
        if (timeSec !== null) {
          emitProgress(timeSec / durationSec);
        }
      }
    };

    const onFfmpegProgress = ({ progress }: ProgressEvent) => {
      if (progress > 0 && progress <= 1) {
        emitProgress(progress);
      }
    };

    this.ffmpeg.on('log', onLog);
    this.ffmpeg.on('progress', onFfmpegProgress);

    try {
      const inputPath = await this.mountInputFile(file);
      plan = buildExtractionPlan({
        inputPath,
        track,
        totalTracks,
        format,
        sourceFileName: file.name,
      });

      const exitCode = await this.ffmpeg.exec([...plan.ffmpegArgs]);

      if (this.cancelled) {
        throw new EngineError('cancelled', 'Cancelled.');
      }

      if (exitCode !== 0) {
        const detail =
          format === 'original'
            ? 'Direct stream copy failed for this container. Try WAV or FLAC instead.'
            : 'Audio extraction failed for this file. Try another output format.';
        throw new EngineError('extraction_failed', detail);
      }

      const rawData = await this.ffmpeg.readFile(plan.outputVirtualName);
      if (typeof rawData === 'string' || rawData.byteLength === 0) {
        throw new EngineError(
          'extraction_failed',
          'Extraction finished with an empty audio file. Try WAV or FLAC.',
        );
      }

      const ownedCopy = new Uint8Array(new ArrayBuffer(rawData.byteLength));
      ownedCopy.set(rawData);
      const blob = new Blob([ownedCopy], { type: plan.mimeType });
      onProgress?.(1);

      return {
        blob,
        sizeBytes: blob.size,
        plan,
        elapsedMs: Math.round(performance.now() - startedAt),
      };
    } catch (err) {
      if (err instanceof EngineError) throw err;
      if (this.cancelled) {
        throw new EngineError('cancelled', 'Cancelled.');
      }
      throw new EngineError(
        'extraction_failed',
        'Audio extraction stopped unexpectedly. Try again or pick WAV.',
      );
    } finally {
      this.ffmpeg.off('log', onLog);
      this.ffmpeg.off('progress', onFfmpegProgress);
      if (plan) {
        await this.safeDeleteFile(plan.outputVirtualName);
      }
      await this.cleanupInput();
    }
  }

  cancel(): void {
    this.cancelled = true;
    this.loadAbort?.abort();
    this.loadAbort = null;
    this.mountedDir = false;
    this.memfsInputPath = null;
    this.loadPromise = null;
    this.ffmpeg.terminate();
    this.ffmpeg = new FFmpeg();
  }

  dispose(): void {
    this.cancel();
  }
}

export async function isWasmCoreCached(): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open('ffmpeg-wasm-core-v1');
    const keys = await cache.keys();
    return keys.some((req) => req.url.includes('ffmpeg-core.wasm'));
  } catch {
    return false;
  }
}
