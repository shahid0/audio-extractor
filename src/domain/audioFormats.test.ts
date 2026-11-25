import { describe, expect, it } from 'vitest';
import {
  buildExtractionPlan,
  buildFormatOptions,
  formatBytes,
  formatDuration,
  resolveOriginalContainer,
  sanitizeDownloadBaseName,
} from './audioFormats';
import type { AudioTrack } from './probeParser';

const aacTrack: AudioTrack = {
  audioIndex: 0,
  streamSpec: '0:1',
  codec: 'aac',
  codecDisplay: 'AAC',
  sampleRateHz: 48000,
  channels: 'stereo',
  bitrateKbps: 256,
  language: 'eng',
  title: null,
  bitDepth: null,
};

const flac24Track: AudioTrack = {
  audioIndex: 1,
  streamSpec: '0:2',
  codec: 'flac',
  codecDisplay: 'FLAC',
  sampleRateHz: 96000,
  channels: 'stereo',
  bitrateKbps: null,
  language: null,
  title: 'Master',
  bitDepth: 24,
};

describe('resolveOriginalContainer', () => {
  it('maps common codecs to their native lossless containers', () => {
    expect(resolveOriginalContainer('aac').extension).toBe('m4a');
    expect(resolveOriginalContainer('alac').extension).toBe('m4a');
    expect(resolveOriginalContainer('opus').extension).toBe('opus');
    expect(resolveOriginalContainer('vorbis').extension).toBe('ogg');
    expect(resolveOriginalContainer('mp3').extension).toBe('mp3');
    expect(resolveOriginalContainer('flac').extension).toBe('flac');
    expect(resolveOriginalContainer('pcm_s16le').extension).toBe('wav');
    expect(resolveOriginalContainer('pcm_s24be').extension).toBe('aiff');
    expect(resolveOriginalContainer('dts').extension).toBe('mka');
  });
});

describe('buildExtractionPlan', () => {
  it('builds stream-copy plan for original AAC without re-encoding', () => {
    const plan = buildExtractionPlan({
      inputPath: '/input/source.mp4',
      track: aacTrack,
      totalTracks: 1,
      format: 'original',
      sourceFileName: 'my video (final).mp4',
    });

    expect(plan.downloadFileName).toBe('my video (final).m4a');
    expect(plan.isLossless).toBe(true);
    expect(plan.ffmpegArgs).toContain('-c:a');
    expect(plan.ffmpegArgs).toContain('copy');
    expect(plan.ffmpegArgs).toContain('-movflags');
    expect(plan.ffmpegArgs).toContain('+faststart');
    expect(plan.ffmpegArgs).toContain('0:a:0');
  });

  it('appends track number for multi-track videos and preserves 24-bit WAV', () => {
    const plan = buildExtractionPlan({
      inputPath: '/input/source.mkv',
      track: flac24Track,
      totalTracks: 2,
      format: 'wav',
      sourceFileName: 'concert.mkv',
    });

    expect(plan.downloadFileName).toBe('concert-track2.wav');
    expect(plan.ffmpegArgs).toContain('pcm_s24le');
    expect(plan.ffmpegArgs).toContain('0:a:1');
  });

  it('builds FLAC and MP3 320k plans accurately', () => {
    const flacPlan = buildExtractionPlan({
      inputPath: '/input/source.mov',
      track: aacTrack,
      totalTracks: 1,
      format: 'flac',
      sourceFileName: 'clip.mov',
    });
    expect(flacPlan.isLossless).toBe(true);
    expect(flacPlan.ffmpegArgs).toContain('flac');

    const mp3Plan = buildExtractionPlan({
      inputPath: '/input/source.mov',
      track: aacTrack,
      totalTracks: 1,
      format: 'mp3',
      sourceFileName: 'clip.mov',
    });
    expect(mp3Plan.isLossless).toBe(false);
    expect(mp3Plan.ffmpegArgs).toContain('libmp3lame');
    expect(mp3Plan.ffmpegArgs).toContain('320k');
  });
});

describe('formatting and sanitization helpers', () => {
  it('sanitizes filenames cleanly', () => {
    expect(sanitizeDownloadBaseName('foo/bar:baz?.mp4')).toBe('foo_bar_baz_');
    expect(sanitizeDownloadBaseName('noext')).toBe('noext');
    expect(sanitizeDownloadBaseName('   ')).toBe('audio');
  });

  it('formats bytes and durations', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.50 KB');
    expect(formatBytes(12.4 * 1024 * 1024)).toBe('12.4 MB');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3665)).toBe('1:01:05');
    expect(formatDuration(null)).toBe('--:--');
  });

  it('builds four format options starting with Original stream', () => {
    const options = buildFormatOptions(aacTrack);
    expect(options).toHaveLength(4);
    expect(options[0]?.id).toBe('original');
    expect(options[0]?.extension).toBe('m4a');
  });
});
