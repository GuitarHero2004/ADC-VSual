import { spawn } from 'node:child_process';
import { builtinModules, createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// Opt-in real Electron check, separate from mocked tests and headless CI.
const directory = fileURLToPath(new URL('../dist', import.meta.url));
await build({
  configFile: false,
  publicDir: false,
  build: {
    target: 'node22',
    outDir: directory,
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL('./smoke-main.ts', import.meta.url)),
      formats: ['cjs'],
      fileName: () => 'smoke.cjs',
    },
    rolldownOptions: {
      platform: 'node',
      external: ['electron', ...builtinModules, /^node:/],
    },
  },
});
const electron: string = createRequire(import.meta.url)('electron');
const profile = await mkdtemp(join(tmpdir(), 'vsual-desktop-smoke-'));
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  VSUAL_SMOKE_PROFILE: profile,
};
// The desktop runtime must run as Electron, regardless of the invoking shell.
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [join(directory, 'smoke.cjs')], {
  env: environment,
  windowsHide: true,
  stdio: 'inherit',
});
child.once('error', () => {
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code === 0 ? 0 : 1;
});
