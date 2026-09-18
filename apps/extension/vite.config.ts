import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'chrome114',
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
});
