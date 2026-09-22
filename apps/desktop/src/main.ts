import { app, dialog, Menu, protocol } from 'electron';
import { createDesktopHost } from './host.ts';

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
    // A launch during initialization is covered by the initial show below.
    host?.show();
  });
  app.on('activate', () => host?.show());
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
            { label: 'Open VSual', click: () => host?.show() },
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
        host.show();
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
