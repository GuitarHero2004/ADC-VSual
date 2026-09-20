import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { createManifest } from './manifest.ts';

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    {
      name: 'extension-manifest',
      generateBundle() {
        const environment = loadEnv(
          mode,
          fileURLToPath(new URL('.', import.meta.url)),
          'VITE_',
        );
        this.emitFile({
          type: 'asset',
          fileName: 'manifest.json',
          source: JSON.stringify(createManifest(environment), null, 2),
        });
      },
    },
  ],
  build: {
    target: 'chrome116',
    rolldownOptions: {
      input: {
        panel: fileURLToPath(new URL('./index.html', import.meta.url)),
        background: fileURLToPath(
          new URL('./src/background.ts', import.meta.url),
        ),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background'
            ? 'background.js'
            : 'assets/[name]-[hash].js',
      },
    },
  },
}));
