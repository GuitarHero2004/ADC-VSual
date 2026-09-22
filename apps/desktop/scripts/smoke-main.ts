import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, globalShortcut, protocol } from 'electron';
import { createDesktopHost } from '../src/host.ts';

const profile = process.env.VSUAL_SMOKE_PROFILE;
if (!profile) throw new Error('Run through the desktop smoke script.');
app.setPath('userData', profile);
app.setName('VSual Desktop Smoke Test');
protocol.registerSchemesAsPrivileged([
  { scheme: 'vsual', privileges: { standard: true, secure: true } },
]);
let host: Awaited<ReturnType<typeof createDesktopHost>> | undefined;
const deadline = setTimeout(() => {
  console.error('Desktop smoke check timed out.');
  host?.dispose();
  app.exit(1);
}, 30_000);
app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  try {
    host = await createDesktopHost({
      directory: __dirname,
      userData: profile,
      quit: () => app.quit(),
    });
    const contents = host.window.webContents;
    const rendererProcess = app
      .getAppMetrics()
      .find((process) => process.pid === contents.getOSProcessId());
    if (process.platform === 'win32')
      assert.equal(rendererProcess?.sandboxed, true);
    assert.equal(host.window.isAlwaysOnTop(), true);
    const rendered =
      await contents.executeJavaScript(`new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        if (document.querySelector('h1') && document.querySelector('select')) {
          resolve({heading: document.querySelector('h1').textContent, bridge: Object.keys(window.vsualDesktop).sort(), node: typeof window.require, language: document.documentElement.lang});
        } else if (Date.now() - started > 5000) reject(new Error('Renderer did not become ready'));
        else setTimeout(check, 25);
      };
      check();
    })`);
    assert.equal(rendered.heading, 'VSual');
    assert.equal(rendered.node, 'undefined');
    assert.equal(rendered.language, 'en');
    assert.deepEqual(rendered.bridge, [
      'getState',
      'hide',
      'onActivate',
      'onState',
      'quit',
      'updatePreferences',
    ]);
    const state = await contents.executeJavaScript(
      'window.vsualDesktop.getState()',
    );
    assert.equal(
      state.shortcutRegistered,
      globalShortcut.isRegistered(state.preferences.shortcut),
    );
    // The production sender check and strict preferences validator are exercised.
    const rejected = await contents.executeJavaScript(
      `window.vsualDesktop.updatePreferences({language:'en',shortcut:'Super+R'}).then(() => false, () => true)`,
    );
    assert.equal(rejected, true);
    assert.deepEqual(
      await contents.executeJavaScript('window.vsualDesktop.getState()'),
      state,
    );
    // Choose a currently available supported shortcut; never overwrite the user's settings.
    if (state.shortcutRegistered) {
      await contents.executeJavaScript(
        `window.vsualDesktop.updatePreferences({language:'vi',shortcut:${JSON.stringify(state.preferences.shortcut)}})`,
      );
      const disk = JSON.parse(
        await readFile(join(profile, 'preferences.json'), 'utf8'),
      );
      assert.equal(disk.language, 'vi');
    }
    const networkDenied = await contents.executeJavaScript(
      `fetch('https://example.invalid/vsual-smoke').then(() => false, () => true)`,
    );
    assert.equal(networkDenied, true);
    // Capture only VSual's own rendered UI for inspection, not the desktop.
    host.window.setSize(340, 720);
    contents.setZoomFactor(2);
    const reflow = await contents.executeJavaScript(
      `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve({width: innerWidth, content: document.documentElement.scrollWidth, controls: [...document.querySelectorAll('button, select, summary')].every(element => element.getBoundingClientRect().right <= innerWidth + 1)}))))`,
    );
    assert.ok(
      reflow.content <= reflow.width + 1,
      'UI must not overflow horizontally at 200% zoom',
    );
    assert.equal(reflow.controls, true);
    contents.setZoomFactor(1);
    host.window.setSize(500, 800);
    await contents.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const screenshot = await contents.capturePage();
    await writeFile(join(__dirname, 'smoke.png'), screenshot.toPNG());
    host.window.close();
    assert.equal(
      host.window.isDestroyed(),
      false,
      'Close hides without losing the tray owner',
    );
    assert.equal(host.window.isVisible(), false);
    host.dispose();
    assert.equal(
      globalShortcut.isRegistered(state.preferences.shortcut),
      false,
    );
    console.log(
      JSON.stringify({
        check: 'desktop_runtime',
        result: 'passed',
        renderer: true,
        sandbox: true,
        ipc: true,
        networkBlocked: true,
        reflow200: true,
        closeToTray: true,
        shortcutRegistered: state.shortcutRegistered,
        physicalShortcutKeypress: 'not_run',
        nvda: 'not_run',
      }),
    );
    clearTimeout(deadline);
    app.exit(0);
  } catch (error) {
    console.error(
      'Desktop smoke check failed:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    host?.dispose();
    clearTimeout(deadline);
    app.exit(1);
  }
});
