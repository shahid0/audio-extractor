import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExtractionPlan, OutputFormatId } from '../domain/audioFormats';
import type { AudioTrack, ProbeResult } from '../domain/probeParser';
import {
  EngineError,
  FfmpegWasmEngine,
  isWasmCoreCached,
  type AudioExtractorEngine,
} from '../engine/ffmpegClient';

export type EngineCacheState = 'checking' | 'not_cached' | 'loading' | 'ready';

export interface ReadyData {
  readonly file: File;
  readonly probe: ProbeResult;
  readonly selectedTrackIndex: number;
  readonly format: OutputFormatId;
}

export interface DoneData {
  readonly file: File;
  readonly probe: ProbeResult;
  readonly selectedTrackIndex: number;
  readonly format: OutputFormatId;
  readonly audioUrl: string;
  readonly sizeBytes: number;
  readonly plan: ExtractionPlan;
  readonly elapsedMs: number;
  readonly blob: Blob;
}

export type ExtractorState =
  | { readonly status: 'idle' }
  | { readonly status: 'inspecting'; readonly file: File; readonly engineProgress: number }
  | { readonly status: 'ready'; readonly data: ReadyData }
  | { readonly status: 'extracting'; readonly data: ReadyData; readonly progress: number }
  | { readonly status: 'done'; readonly data: DoneData }
  | {
      readonly status: 'error';
      readonly file: File | null;
      readonly readyFallback: ReadyData | null;
      readonly message: string;
      readonly canRetry: boolean;
    };

export function useExtractor(engineFactory?: () => AudioExtractorEngine) {
  const engineRef = useRef<AudioExtractorEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = engineFactory ? engineFactory() : new FfmpegWasmEngine();
  }

  const [state, setState] = useState<ExtractorState>({ status: 'idle' });
  const [engineCache, setEngineCache] = useState<EngineCacheState>('checking');
  const stateRef = useRef(state);
  stateRef.current = state;
  const activeRunIdRef = useRef(0);
  const objectUrlRef = useRef<string | null>(null);

  const revokeOutputUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    isWasmCoreCached().then((cached) => {
      if (!alive) return;
      setEngineCache((prev) => (prev === 'ready' ? prev : cached ? 'ready' : 'not_cached'));
    });

    return () => {
      alive = false;
      revokeOutputUrl();
      engineRef.current?.dispose();
    };
  }, [revokeOutputUrl]);

  const selectFile = useCallback(
    async (file: File) => {
      const engine = engineRef.current;
      if (!engine) return;

      // Cancel any running inspect/extract cleanly before starting on the new file
      const currentStatus = stateRef.current.status;
      if (currentStatus === 'inspecting' || currentStatus === 'extracting') {
        engine.cancel();
      }
      revokeOutputUrl();

      const runId = ++activeRunIdRef.current;
      setState({
        status: 'inspecting',
        file,
        engineProgress: engine.isLoaded() ? 1 : 0,
      });

      if (!engine.isLoaded()) {
        setEngineCache('loading');
      }

      try {
        if (!engine.isLoaded()) {
          await engine.load((ratio) => {
            if (activeRunIdRef.current !== runId) return;
            setState((prev) =>
              prev.status === 'inspecting' ? { ...prev, engineProgress: ratio } : prev,
            );
          });
        }

        if (activeRunIdRef.current !== runId) return;
        setEngineCache('ready');

        const probe = await engine.inspect(file);
        if (activeRunIdRef.current !== runId) return;

        setState({
          status: 'ready',
          data: {
            file,
            probe,
            selectedTrackIndex: 0,
            format: 'original',
          },
        });
      } catch (err) {
        if (activeRunIdRef.current !== runId) return;
        if (err instanceof EngineError && err.code === 'cancelled') {
          setState({ status: 'idle' });
          return;
        }

        const isEngineError = err instanceof EngineError;
        if (isEngineError && (err.code === 'engine_load_failed' || err.code === 'offline_engine_missing')) {
          setEngineCache('not_cached');
        }

        setState({
          status: 'error',
          file,
          readyFallback: null,
          message: isEngineError ? err.message : 'Could not inspect this video.',
          canRetry: !isEngineError || err.code !== 'no_audio_track',
        });
      }
    },
    [revokeOutputUrl],
  );

  const setSelectedTrackIndex = useCallback((trackIndex: number) => {
    setState((prev) => {
      if (prev.status === 'ready') {
        return {
          status: 'ready',
          data: { ...prev.data, selectedTrackIndex: trackIndex },
        };
      }
      if (prev.status === 'done') {
        revokeOutputUrl();
        return {
          status: 'ready',
          data: {
            file: prev.data.file,
            probe: prev.data.probe,
            selectedTrackIndex: trackIndex,
            format: prev.data.format,
          },
        };
      }
      return prev;
    });
  }, [revokeOutputUrl]);

  const setFormat = useCallback((format: OutputFormatId) => {
    setState((prev) => {
      if (prev.status === 'ready') {
        return {
          status: 'ready',
          data: { ...prev.data, format },
        };
      }
      if (prev.status === 'done') {
        revokeOutputUrl();
        return {
          status: 'ready',
          data: {
            file: prev.data.file,
            probe: prev.data.probe,
            selectedTrackIndex: prev.data.selectedTrackIndex,
            format,
          },
        };
      }
      return prev;
    });
  }, [revokeOutputUrl]);

  const startExtraction = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;

    const current = stateRef.current;
    let readyData: ReadyData | null = null;
    if (current.status === 'ready') {
      readyData = current.data;
    } else if (current.status === 'error' && current.readyFallback) {
      readyData = current.readyFallback;
    } else {
      return;
    }

    const track: AudioTrack | undefined = readyData.probe.tracks[readyData.selectedTrackIndex];
    if (!track) return;

    const runId = ++activeRunIdRef.current;
    revokeOutputUrl();
    const extractingState: ExtractorState = { status: 'extracting', data: readyData, progress: 0 };
    stateRef.current = extractingState;
    setState(extractingState);

    try {
      const extracted = await engine.extract({
        file: readyData.file,
        track,
        totalTracks: readyData.probe.tracks.length,
        durationSec: readyData.probe.durationSec,
        format: readyData.format,
        onProgress: (ratio) => {
          if (activeRunIdRef.current !== runId) return;
          setState((prev) =>
            prev.status === 'extracting' ? { ...prev, progress: ratio } : prev,
          );
        },
      });

      if (activeRunIdRef.current !== runId) return;

      const audioUrl = URL.createObjectURL(extracted.blob);
      objectUrlRef.current = audioUrl;

      setState({
        status: 'done',
        data: {
          ...readyData,
          audioUrl,
          sizeBytes: extracted.sizeBytes,
          plan: extracted.plan,
          elapsedMs: extracted.elapsedMs,
          blob: extracted.blob,
        },
      });
    } catch (err) {
      if (activeRunIdRef.current !== runId) return;
      if (err instanceof EngineError && err.code === 'cancelled') {
        setState({ status: 'ready', data: readyData });
        return;
      }

      setState({
        status: 'error',
        file: readyData.file,
        readyFallback: readyData,
        message: err instanceof EngineError ? err.message : 'Audio extraction failed.',
        canRetry: true,
      });
    }
  }, [revokeOutputUrl]);

  const cancel = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;

    activeRunIdRef.current += 1;
    engine.cancel();

    setState((prev) => {
      if (prev.status === 'extracting') {
        return { status: 'ready', data: prev.data };
      }
      return { status: 'idle' };
    });
  }, []);

  const retry = useCallback(() => {
    if (state.status !== 'error') return;
    if (state.readyFallback) {
      void startExtraction();
    } else if (state.file) {
      void selectFile(state.file);
    } else {
      setState({ status: 'idle' });
    }
  }, [selectFile, startExtraction, state]);

  const backToOptions = useCallback(() => {
    setState((prev) => {
      if (prev.status === 'done') {
        revokeOutputUrl();
        return {
          status: 'ready',
          data: {
            file: prev.data.file,
            probe: prev.data.probe,
            selectedTrackIndex: prev.data.selectedTrackIndex,
            format: prev.data.format,
          },
        };
      }
      if (prev.status === 'error' && prev.readyFallback) {
        return { status: 'ready', data: prev.readyFallback };
      }
      return prev;
    });
  }, [revokeOutputUrl]);

  const reset = useCallback(() => {
    const currentStatus = stateRef.current.status;
    if (currentStatus === 'inspecting' || currentStatus === 'extracting') {
      activeRunIdRef.current += 1;
      engineRef.current?.cancel();
    }
    revokeOutputUrl();
    setState({ status: 'idle' });
  }, [revokeOutputUrl]);

  return {
    state,
    engineCache,
    selectFile,
    setSelectedTrackIndex,
    setFormat,
    startExtraction,
    cancel,
    retry,
    backToOptions,
    reset,
  };
}
