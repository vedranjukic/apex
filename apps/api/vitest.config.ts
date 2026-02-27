import { defineConfig } from 'vitest/config';
import { join } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@apex/orchestrator': join(__dirname, '../../libs/orchestrator/src/index.ts'),
      '@apex/shared': join(__dirname, '../../libs/shared/src/index.ts'),
    },
  },
});
