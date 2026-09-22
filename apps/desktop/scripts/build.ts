import { builtinModules } from 'node:module';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const outDir = fileURLToPath(new URL('../dist', import.meta.url));

await build({
  configFile: false,
  root,
  base: './',
  publicDir: false,
  build: { outDir: `${outDir}/renderer`, target: 'chrome140' },
});
for (const entry of ['main', 'preload']) {
  await build({
    configFile: false,
    root,
    publicDir: false,
    build: {
      target: 'node22',
      outDir,
      emptyOutDir: false,
      minify: false,
      lib: {
        entry: `${root}/src/${entry}.ts`,
        formats: ['cjs'],
        fileName: () => `${entry}.cjs`,
      },
      rolldownOptions: {
        platform: 'node',
        external: ['electron', ...builtinModules, /^node:/],
      },
    },
  });
}
await mkdir(outDir, { recursive: true });
await copyFile(
  fileURLToPath(
    new URL('../../extension/src/assets/vsual-logo.png', import.meta.url),
  ),
  `${outDir}/vsual-logo.png`,
);
