import { fileURLToPath, URL } from 'node:url';
import { build, defineConfig, loadEnv } from 'vite';
import { createManifest } from './manifest.ts';

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    {
      name: 'extension-manifest',
      buildStart() {
        for (const file of [
          './src/orders-content.ts',
          './src/orders-adapter.ts',
          './src/config-values.ts',
          '../../packages/contracts/src/grounded.ts',
          '../../packages/contracts/src/index.ts',
        ])
          this.addWatchFile(fileURLToPath(new URL(file, import.meta.url)));
      },
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
      async writeBundle() {
        const environment = loadEnv(
          mode,
          fileURLToPath(new URL('.', import.meta.url)),
          'VITE_',
        );
        // Chromium manifest content scripts are classic scripts, so bundle this isolated entry as an IIFE.
        await build({
          configFile: false,
          publicDir: false,
          define: {
            'import.meta.env.VITE_API_BASE_URL': JSON.stringify(
              environment.VITE_API_BASE_URL ?? '',
            ),
            'import.meta.env.VITE_ORDERS_ORIGINS': JSON.stringify(
              environment.VITE_ORDERS_ORIGINS ?? '',
            ),
          },
          build: {
            target: 'chrome116',
            outDir: fileURLToPath(new URL('./dist', import.meta.url)),
            emptyOutDir: false,
            lib: {
              entry: fileURLToPath(
                new URL('./src/orders-content.ts', import.meta.url),
              ),
              name: 'VSualOrders',
              formats: ['iife'],
              fileName: () => 'orders-content.js',
            },
          },
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
