# Audio Extractor

Installable Progressive Web App (PWA) that extracts full-quality audio tracks from video files directly on your device using FFmpeg WebAssembly.

**Live app:** https://shahid0.github.io/audio-extractor/

## Features

- **Lossless original stream copy (default):** Demuxes the original audio track without re-encoding (`-c:a copy`) into its native container (`.m4a` for AAC/ALAC, `.opus` for Opus, `.ogg` for Vorbis, `.flac` for FLAC, `.mp3` for MP3, `.wav`/`.aiff` for PCM, `.mka` fallback).
- **Additional full-quality formats:** Uncompressed WAV (16-bit or 24-bit PCM), lossless FLAC, or 320 kbps MP3.
- **Multi-track support:** Inspects all audio streams in a video and lets you choose which track to extract.
- **Zero upfront RAM copy:** Mounts input videos with FFmpeg's `WORKERFS` so large video files don't blow up browser memory.
- **Offline PWA:** Self-hosts the FFmpeg WebAssembly core and caches it locally via the Service Worker after first use.

## Development

```bash
npm install
npm run dev
```

## Build & Test

```bash
npm test
npm run build
```
