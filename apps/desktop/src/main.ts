import { app, dialog, Menu, protocol } from 'electron';
import { createDesktopHost } from './host.ts';
import { loadEnvFile } from 'node:process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// Runtime-only desktop settings; never load the backend's private provider keys.
const environmentFile = join(__dirname, '..', '.env.local');
if (existsSync(environmentFile)) loadEnvFile(environmentFile);

app.setName('VSual Desktop');
protocol.registerSchemesAsPrivileged([
  { scheme: 'vsual', privileges: { standard: true, secure: true } },
]);

// The app stays available in the tray; a second launch only opens the same UI.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let host: Awaited<ReturnType<typeof createDesktopHost>> | undefined;
  let quitting = false;
  app.on('second-instance', () => {
    // A launch during initialization is covered by initial activation below.
    void host?.activate();
  });
  app.on('activate', () => void host?.activate());
  app.on('before-quit', () => {
    quitting = true;
    host?.dispose();
  });
  app.on('window-all-closed', () => {
    if (quitting) app.quit();
  });
  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: 'VSual',
          submenu: [
            { label: 'Open VSual', click: () => void host?.activate() },
            { label: 'Hide to tray', click: () => host?.hide() },
            { type: 'separator' },
            { role: 'quit', label: 'Quit VSual' },
          ],
        },
        { role: 'editMenu' },
        {
          role: 'viewMenu',
          submenu: [
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
          ],
        },
      ]),
    );
    try {
      host = await createDesktopHost({
        directory: __dirname,
        userData: app.getPath('userData'),
        quit: () => app.quit(),
      });
      if (quitting) host.dispose();
      else {
        // Explicit app launch opens the window; it never starts other work.
        await host.activate();
      }
    } catch {
      if (!quitting)
        dialog.showErrorBox(
          'VSual could not open',
          'Build the desktop app again, then retry. No microphone or screen capture was started.',
        );
      app.exit(1);
    }
  });
}
