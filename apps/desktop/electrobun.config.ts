import type { ElectrobunConfig } from 'electrobun';
import { readFileSync } from 'fs';

let version = '0.0.1';
try {
  version = readFileSync('../../VERSION', 'utf8').trim();
} catch {
  // fallback version
}

export default {
  app: {
    name: 'Apex',
    identifier: 'com.apex.desktop',
    version,
  },
  runtime: {
    exitOnLastWindowClosed: false,
  },
  build: {
    bun: {
      entrypoint: 'src/bun/index.ts',
      external: ['better-sqlite3'],
    },
    views: {
      preload: {
        entrypoint: 'src/preload/index.ts',
      },
    },
    mac: {
      icons: '../../assets/logo/icon.iconset',
    },
  },
} satisfies ElectrobunConfig;
