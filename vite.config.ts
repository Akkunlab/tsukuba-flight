import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    host: true,
    // ローカル開発中の /api は wrangler dev（8787）へ流す
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
