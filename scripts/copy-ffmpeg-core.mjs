import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const coreDir = resolve(root, 'node_modules/@ffmpeg/core/dist/esm');
const destDir = resolve(root, 'public/ffmpeg');

const files = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

mkdirSync(destDir, { recursive: true });

for (const file of files) {
  const src = resolve(coreDir, file);
  const dst = resolve(destDir, file);
  if (!existsSync(src)) {
    throw new Error(`Missing @ffmpeg/core asset: ${src}`);
  }
  cpSync(src, dst);
}

console.log(`Copied FFmpeg core assets to ${destDir}`);
