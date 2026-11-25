import { describe, expect, it } from 'vitest';
import { formatCodecDisplay, parseProbeLogs, parseProgressTimeSec } from './probeParser';

describe('parseProbeLogs', () => {
  it('parses duration and single AAC audio stream from MP4 probe output', () => {
    const logs = [
      'Input #0, mov,mp4,m4a,3gp,3g2,mj2, from \'/input/source.mp4\':',
      '  Duration: 00:03:45.62, start: 0.000000, bitrate: 8420 kb/s',
      '  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1920x1080, 8200 kb/s, 30 fps',
      '  Stream #0:1[0x2](eng): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 192 kb/s (default)',
      '    Metadata:',
      '      handler_name    : SoundHandler',
      '      title           : Main Mix',
    ];

    const result = parseProbeLogs(logs);
    expect(result.durationSec).toBeCloseTo(225.62, 2);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toEqual({
      audioIndex: 0,
      streamSpec: '0:1',
      codec: 'aac',
      codecDisplay: 'AAC',
      sampleRateHz: 48000,
      channels: 'stereo',
      bitrateKbps: 192,
      language: 'eng',
      title: 'Main Mix',
      bitDepth: null,
    });
  });

  it('parses multiple audio tracks with sequential audioIndex values and ignores und language', () => {
    const logs = [
      '  Duration: 01:02:03.50, start: 0.000000, bitrate: 4200 kb/s',
      '  Stream #0:0: Video: vp9, yuv420p, 1280x720',
      '  Stream #0:1(und): Audio: opus, 48000 Hz, stereo, fltp (default)',
      '  Stream #0:2(jpn): Audio: flac, 96000 Hz, 5.1(side), s24 (24 bit)',
      '    Metadata:',
      '      title           : Studio Master',
      '  Stream #0:3: Subtitle: subrip',
    ];

    const result = parseProbeLogs(logs);
    expect(result.durationSec).toBeCloseTo(3723.5, 2);
    expect(result.tracks).toHaveLength(2);
    expect(result.tracks[0]).toMatchObject({
      audioIndex: 0,
      codec: 'opus',
      codecDisplay: 'Opus',
      language: null,
      channels: 'stereo',
      sampleRateHz: 48000,
    });
    expect(result.tracks[1]).toMatchObject({
      audioIndex: 1,
      codec: 'flac',
      codecDisplay: 'FLAC',
      language: 'jpn',
      channels: '5.1',
      sampleRateHz: 96000,
      bitDepth: 24,
      title: 'Studio Master',
    });
  });

  it('returns empty tracks for silent video', () => {
    const logs = [
      '  Duration: 00:00:10.00, start: 0.000000, bitrate: 1200 kb/s',
      '  Stream #0:0(und): Video: h264, yuv420p, 640x360',
    ];
    const result = parseProbeLogs(logs);
    expect(result.durationSec).toBe(10);
    expect(result.tracks).toEqual([]);
  });

  it('formats PCM bit depth cleanly', () => {
    expect(formatCodecDisplay('pcm_s24le')).toBe('PCM 24-bit');
    expect(formatCodecDisplay('pcm_s16be')).toBe('PCM 16-bit');
    expect(formatCodecDisplay('alac')).toBe('ALAC');
  });
});

describe('parseProgressTimeSec', () => {
  it('parses FFmpeg stderr progress time', () => {
    expect(
      parseProgressTimeSec('size=    1024kB time=00:01:23.45 bitrate= 192.0kbits/s speed=12.4x'),
    ).toBeCloseTo(83.45, 2);
  });

  it('returns null for N/A or negative timestamps', () => {
    expect(parseProgressTimeSec('size=       0kB time=N/A bitrate=N/A')).toBeNull();
    expect(parseProgressTimeSec('size=       0kB time=-00:00:01.00 bitrate=N/A')).toBeNull();
  });
});
