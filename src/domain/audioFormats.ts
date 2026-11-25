import type { AudioTrack } from './probeParser';

export type OutputFormatId = 'original' | 'wav' | 'flac' | 'mp3';

export interface LosslessContainer {
  readonly extension: string;
  readonly mimeType: string;
  readonly muxerArgs: readonly string[];
}

export interface ExtractionPlan {
  readonly format: OutputFormatId;
  readonly extension: string;
  readonly mimeType: string;
  readonly outputVirtualName: string;
  readonly downloadFileName: string;
  readonly ffmpegArgs: readonly string[];
  readonly isLossless: boolean;
  readonly qualityBadge: string;
}

export interface FormatOption {
  readonly id: OutputFormatId;
  readonly label: string;
  readonly detail: string;
  readonly extension: string;
  readonly isLossless: boolean;
}

export function resolveOriginalContainer(codec: string): LosslessContainer {
  const lower = codec.toLowerCase();

  if (lower === 'aac' || lower === 'alac') {
    return {
      extension: 'm4a',
      mimeType: 'audio/mp4',
      muxerArgs: ['-movflags', '+faststart'],
    };
  }
  if (lower === 'mp3') {
    return { extension: 'mp3', mimeType: 'audio/mpeg', muxerArgs: [] };
  }
  if (lower === 'flac') {
    return { extension: 'flac', mimeType: 'audio/flac', muxerArgs: [] };
  }
  if (lower === 'opus') {
    return { extension: 'opus', mimeType: 'audio/ogg; codecs=opus', muxerArgs: ['-f', 'opus'] };
  }
  if (lower === 'vorbis') {
    return { extension: 'ogg', mimeType: 'audio/ogg', muxerArgs: [] };
  }
  if (lower.startsWith('pcm_')) {
    if (lower.endsWith('be')) {
      return { extension: 'aiff', mimeType: 'audio/aiff', muxerArgs: [] };
    }
    return { extension: 'wav', mimeType: 'audio/wav', muxerArgs: [] };
  }
  if (lower === 'ac3') {
    return { extension: 'ac3', mimeType: 'audio/ac3', muxerArgs: [] };
  }
  if (lower === 'eac3') {
    return { extension: 'eac3', mimeType: 'audio/eac3', muxerArgs: [] };
  }
  if (lower === 'mp2') {
    return { extension: 'mp2', mimeType: 'audio/mpeg', muxerArgs: [] };
  }
  if (lower.startsWith('wma')) {
    return { extension: 'wma', mimeType: 'audio/x-ms-wma', muxerArgs: [] };
  }

  return { extension: 'mka', mimeType: 'audio/x-matroska', muxerArgs: [] };
}

export function buildFormatOptions(track: AudioTrack): readonly FormatOption[] {
  const orig = resolveOriginalContainer(track.codec);
  const origDetailParts = [track.codecDisplay];
  if (track.bitrateKbps) origDetailParts.push(`${track.bitrateKbps} kbps`);
  origDetailParts.push('no re-encoding');

  const wavBits = track.bitDepth && track.bitDepth > 16 ? 24 : 16;

  return [
    {
      id: 'original',
      label: 'Original stream',
      detail: origDetailParts.join(' · '),
      extension: orig.extension,
      isLossless: true,
    },
    {
      id: 'wav',
      label: 'WAV',
      detail: `Uncompressed ${wavBits}-bit PCM`,
      extension: 'wav',
      isLossless: true,
    },
    {
      id: 'flac',
      label: 'FLAC',
      detail: 'Lossless compressed',
      extension: 'flac',
      isLossless: true,
    },
    {
      id: 'mp3',
      label: 'MP3',
      detail: '320 kbps for broad playback',
      extension: 'mp3',
      isLossless: false,
    },
  ];
}

export function stripFileExtension(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) return 'audio';
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot <= 0) return trimmed;
  return trimmed.slice(0, lastDot);
}

export function sanitizeDownloadBaseName(fileName: string): string {
  const base = stripFileExtension(fileName)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .trim();
  return base || 'audio';
}

export function buildExtractionPlan(params: {
  readonly inputPath: string;
  readonly track: AudioTrack;
  readonly totalTracks: number;
  readonly format: OutputFormatId;
  readonly sourceFileName: string;
}): ExtractionPlan {
  const { inputPath, track, totalTracks, format, sourceFileName } = params;
  const baseName = sanitizeDownloadBaseName(sourceFileName);
  const trackSuffix = totalTracks > 1 ? `-track${track.audioIndex + 1}` : '';

  const baseArgs = [
    '-hide_banner',
    '-y',
    '-i',
    inputPath,
    '-map',
    `0:a:${track.audioIndex}`,
    '-vn',
    '-sn',
    '-dn',
  ];

  if (format === 'original') {
    const container = resolveOriginalContainer(track.codec);
    const outputVirtualName = `out.${container.extension}`;
    return {
      format,
      extension: container.extension,
      mimeType: container.mimeType,
      outputVirtualName,
      downloadFileName: `${baseName}${trackSuffix}.${container.extension}`,
      ffmpegArgs: [...baseArgs, '-c:a', 'copy', ...container.muxerArgs, outputVirtualName],
      isLossless: true,
      qualityBadge: `Original ${track.codecDisplay} · direct copy`,
    };
  }

  if (format === 'wav') {
    const use24Bit = track.bitDepth !== null && track.bitDepth > 16;
    const pcmCodec = use24Bit ? 'pcm_s24le' : 'pcm_s16le';
    const outputVirtualName = 'out.wav';
    return {
      format,
      extension: 'wav',
      mimeType: 'audio/wav',
      outputVirtualName,
      downloadFileName: `${baseName}${trackSuffix}.wav`,
      ffmpegArgs: [...baseArgs, '-c:a', pcmCodec, outputVirtualName],
      isLossless: true,
      qualityBadge: `WAV ${use24Bit ? '24-bit' : '16-bit'} PCM`,
    };
  }

  if (format === 'flac') {
    const outputVirtualName = 'out.flac';
    return {
      format,
      extension: 'flac',
      mimeType: 'audio/flac',
      outputVirtualName,
      downloadFileName: `${baseName}${trackSuffix}.flac`,
      ffmpegArgs: [...baseArgs, '-c:a', 'flac', '-compression_level', '5', outputVirtualName],
      isLossless: true,
      qualityBadge: 'FLAC lossless',
    };
  }

  const outputVirtualName = 'out.mp3';
  return {
    format,
    extension: 'mp3',
    mimeType: 'audio/mpeg',
    outputVirtualName,
    downloadFileName: `${baseName}${trackSuffix}.mp3`,
    ffmpegArgs: [...baseArgs, '-c:a', 'libmp3lame', '-b:a', '320k', outputVirtualName],
    isLossless: false,
    qualityBadge: 'MP3 320 kbps',
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx += 1;
  }
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[unitIdx]}`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '--:--';
  const totalSec = Math.round(seconds);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hrs > 0) return `${hrs}:${pad(mins)}:${pad(secs)}`;
  return `${mins}:${pad(secs)}`;
}

export function formatSampleRate(hz: number | null): string | null {
  if (!hz || !Number.isFinite(hz)) return null;
  const khz = hz / 1000;
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
}

export function formatTrackSpecs(track: AudioTrack): string {
  const parts: string[] = [track.codecDisplay];
  const sr = formatSampleRate(track.sampleRateHz);
  if (sr) parts.push(sr);
  if (track.channels) parts.push(track.channels);
  if (track.bitrateKbps) parts.push(`${track.bitrateKbps} kbps`);
  return parts.join(' · ');
}

export function formatTrackLabel(track: AudioTrack, index: number): string {
  const base = track.title
    ? track.title
    : track.language
      ? `Track ${index + 1} (${track.language.toUpperCase()})`
      : `Track ${index + 1}`;
  return `${base} — ${formatTrackSpecs(track)}`;
}
