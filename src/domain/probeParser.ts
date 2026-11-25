export interface AudioTrack {
  readonly audioIndex: number;
  readonly streamSpec: string;
  readonly codec: string;
  readonly codecDisplay: string;
  readonly sampleRateHz: number | null;
  readonly channels: string | null;
  readonly bitrateKbps: number | null;
  readonly language: string | null;
  readonly title: string | null;
  readonly bitDepth: number | null;
}

export interface ProbeResult {
  readonly durationSec: number | null;
  readonly tracks: readonly AudioTrack[];
}

const DURATION_RE = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;
const STREAM_AUDIO_RE =
  /Stream\s+#(\d+:\d+)(?:\[[^\]]+\])?(?:\(([^)]+)\))?[^:]*:\s*Audio:\s*(.+)$/;
const SAMPLE_RATE_RE = /(\d+)\s*Hz/i;
const BITRATE_RE = /(\d+)\s*kb\/s/i;
const PROGRESS_TIME_RE = /time=(-?\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;

const CODEC_LABELS: Readonly<Record<string, string>> = {
  aac: 'AAC',
  alac: 'ALAC',
  opus: 'Opus',
  vorbis: 'Vorbis',
  mp3: 'MP3',
  mp2: 'MP2',
  flac: 'FLAC',
  ac3: 'AC-3',
  eac3: 'E-AC-3',
  dts: 'DTS',
  wmav1: 'WMA',
  wmav2: 'WMA',
  wmapro: 'WMA Pro',
  wmalossless: 'WMA Lossless',
  amr_nb: 'AMR-NB',
  amr_wb: 'AMR-WB',
  truehd: 'TrueHD',
};

export function formatCodecDisplay(codec: string): string {
  const lower = codec.toLowerCase();
  if (CODEC_LABELS[lower]) {
    return CODEC_LABELS[lower];
  }
  if (lower.startsWith('pcm_')) {
    const bits = detectBitDepth(lower, '');
    return bits ? `PCM ${bits}-bit` : 'PCM';
  }
  return codec.toUpperCase();
}

function detectBitDepth(codec: string, details: string): number | null {
  const pcmMatch = /pcm_[suif](\d+)/i.exec(codec);
  if (pcmMatch?.[1]) {
    return Number(pcmMatch[1]);
  }
  if (/\bs32\b|\bs32p\b/i.test(details)) return 32;
  if (/\bs24\b|\bs24p\b/i.test(details)) return 24;
  if (/\bs16\b|\bs16p\b/i.test(details)) return 16;
  return null;
}

function parseChannels(parts: readonly string[]): string | null {
  for (const raw of parts) {
    const part = raw.trim().toLowerCase();
    if (
      part === 'mono' ||
      part === 'stereo' ||
      /^\d+\.\d+(\([^)]+\))?$/.test(part) ||
      /^\d+\s+channels$/.test(part)
    ) {
      return raw.trim().replace(/\([^)]+\)$/, '').trim();
    }
  }
  return null;
}

function normalizeLanguage(lang: string | undefined): string | null {
  if (!lang) return null;
  const cleaned = lang.trim().toLowerCase();
  if (!cleaned || cleaned === 'und' || cleaned === 'unknown') return null;
  return cleaned;
}

function parseHmsToSeconds(hours: string, minutes: string, seconds: string): number {
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

export function parseProbeLogs(lines: readonly string[]): ProbeResult {
  let durationSec: number | null = null;
  const tracks: AudioTrack[] = [];
  let inAudioStreamMetadata = false;

  for (const line of lines) {
    if (durationSec === null) {
      const durMatch = DURATION_RE.exec(line);
      if (durMatch?.[1] && durMatch[2] && durMatch[3]) {
        const parsed = parseHmsToSeconds(durMatch[1], durMatch[2], durMatch[3]);
        if (Number.isFinite(parsed) && parsed > 0) {
          durationSec = parsed;
        }
      }
    }

    const streamMatch = STREAM_AUDIO_RE.exec(line);
    if (streamMatch?.[1] && streamMatch[3]) {
      const streamSpec = streamMatch[1];
      const language = normalizeLanguage(streamMatch[2]);
      const details = streamMatch[3];
      const parts = details.split(',');
      const codecPart = parts[0]?.trim() ?? '';
      const codecToken = codecPart.split(/[\s(]/)[0]?.toLowerCase() ?? 'unknown';

      const srMatch = SAMPLE_RATE_RE.exec(details);
      const brMatch = BITRATE_RE.exec(details);
      const restParts = parts.slice(1);

      tracks.push({
        audioIndex: tracks.length,
        streamSpec,
        codec: codecToken,
        codecDisplay: formatCodecDisplay(codecToken),
        sampleRateHz: srMatch?.[1] ? Number(srMatch[1]) : null,
        channels: parseChannels(restParts),
        bitrateKbps: brMatch?.[1] ? Number(brMatch[1]) : null,
        language,
        title: null,
        bitDepth: detectBitDepth(codecToken, details),
      });
      inAudioStreamMetadata = false;
      continue;
    }

    if (/^\s*Stream\s+#/.test(line)) {
      inAudioStreamMetadata = false;
      continue;
    }

    if (tracks.length > 0 && /^\s*Metadata:\s*$/.test(line)) {
      inAudioStreamMetadata = true;
      continue;
    }

    if (inAudioStreamMetadata && tracks.length > 0) {
      const titleMatch = /^\s*title\s*:\s*(.+)$/i.exec(line);
      if (titleMatch?.[1]) {
        const current = tracks[tracks.length - 1];
        if (current && !current.title) {
          tracks[tracks.length - 1] = {
            ...current,
            title: titleMatch[1].trim(),
          };
        }
      } else if (!/^\s+\S+\s*:/.test(line)) {
        inAudioStreamMetadata = false;
      }
    }
  }

  return { durationSec, tracks };
}

export function parseProgressTimeSec(line: string): number | null {
  const match = PROGRESS_TIME_RE.exec(line);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  if (match[1].startsWith('-')) return null;
  const seconds = parseHmsToSeconds(match[1], match[2], match[3]);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}
