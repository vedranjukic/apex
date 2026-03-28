/// <reference types='vitest' />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import vsixPlugin from '@codingame/monaco-vscode-rollup-vsix-plugin';
import importMetaUrlPlugin from '@codingame/esbuild-import-meta-url-plugin';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const version = readFileSync(resolve(import.meta.dirname, '../../VERSION'), 'utf-8').trim();

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/dashboard',
  server: {
    port: 4200,
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:6000',
      '/preview': {
        target: 'http://localhost:6000',
        ws: true,
      },
      '/ws': {
        target: 'http://localhost:6000',
        ws: true,
      },
    },
  },
  preview: {
    port: 4200,
    host: '0.0.0.0',
  },
  plugins: [react(), tailwindcss(), vsixPlugin()],
  optimizeDeps: {
    esbuildOptions: {
      plugins: [importMetaUrlPlugin],
    },
  },
  worker: {
    format: 'es' as const,
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
}));
