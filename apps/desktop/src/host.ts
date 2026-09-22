import {
  BrowserWindow,
  Menu,
  Tray,
  globalShortcut,
  ipcMain,
  nativeImage,
  session,
} from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { DesktopSettings } from './settings.ts';
import {
  DESKTOP_URL,
  rendererAsset,
  trustedDesktopSender,
} from './security.ts';
import type { DesktopPreferences, DesktopState } from './bridge.ts';

export interface DesktopHostOptions {
  directory: string;
  userData: string;
  quit(): void;
}

/** Native capabilities are owned here, never exposed as generic renderer APIs. */
export async function createDesktopHost(options: DesktopHostOptions) {
  const rendererDirectory = join(options.directory, 'renderer');
  const preferencesFile = join(options.userData, 'preferences.json');
  const desktopSession = session.fromPartition('vsual-desktop');
  desktopSession.setPermissionCheckHandler(() => false);
  desktopSession.setPermissionRequestHandler((_contents, _permission, reply) =>
    reply(false),
  );
  desktopSession.setDisplayMediaRequestHandler((_request, reply) => reply({}));
  desktopSession.webRequest.onBeforeRequest((details, reply) => {
    reply({ cancel: rendererAsset(details.url, rendererDirectory) === null });
  });
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
  };
  desktopSession.protocol.handle('vsual', async (request) => {
    const file = rendererAsset(request.url, rendererDirectory);
    if (!file || request.method !== 'GET')
      return new Response(null, { status: 403 });
    try {
      return new Response(new Uint8Array(await readFile(file)), {
        headers: {
          'Content-Type':
            mimeTypes[extname(file)] ?? 'application/octet-stream',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy':
            "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });

  const window = new BrowserWindow({
    title: 'VSual — Desktop foundation',
    width: 500,
    height: 720,
    minWidth: 320,
    minHeight: 400,
    show: false,
    alwaysOnTop: true,
    backgroundColor: '#f8fafc',
    icon: join(options.directory, 'vsual-logo.png'),
    webPreferences: {
      preload: join(options.directory, 'preload.cjs'),
      session: desktopSession,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-frame-navigate', (event) =>
    event.preventDefault(),
  );
  window.webContents.on('will-attach-webview', (event) =>
    event.preventDefault(),
  );
  desktopSession.on('will-download', (event) => event.preventDefault());

  let disposed = false;
  let tray: Tray | null = null;
  let pendingActivation = false;
  let ready = false;
  const show = () => {
    if (disposed || window.isDestroyed()) return;
    if (!ready) {
      pendingActivation = true;
      return;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    window.webContents.send('desktop:activated');
  };
  const hide = () => {
    if (disposed || window.isDestroyed()) return;
    window.hide();
  };
  window.on('close', (event) => {
    if (disposed) return;
    event.preventDefault();
    hide();
  });
  const publish = (state: DesktopState) => {
    if (disposed) return;
    const vi = state.preferences.language === 'vi';
    tray?.setToolTip(
      vi ? 'VSual — Trợ lý máy tính' : 'VSual — Desktop companion',
    );
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: vi ? 'Mở VSual' : 'Open VSual', click: show },
        { label: vi ? 'Ẩn vào khay hệ thống' : 'Hide to tray', click: hide },
        { type: 'separator' },
        { label: vi ? 'Thoát VSual' : 'Quit VSual', click: options.quit },
      ]),
    );
    if (!window.isDestroyed())
      window.webContents.send('desktop:state-changed', state);
  };
  const settings = new DesktopSettings(
    globalShortcut,
    {
      async load() {
        if ((await stat(preferencesFile)).size > 4096)
          throw new Error('Invalid preferences file');
        return JSON.parse(await readFile(preferencesFile, 'utf8')) as unknown;
      },
      async save(preferences: DesktopPreferences) {
        await mkdir(options.userData, { recursive: true });
        const temporary = `${preferencesFile}.tmp`;
        await writeFile(temporary, JSON.stringify(preferences), {
          mode: 0o600,
        });
        await rename(temporary, preferencesFile);
      },
    },
    show,
    publish,
  );
  const state = await settings.initialize();
  // A real tray icon is required before enabling close-to-tray.
  const icon = nativeImage.createFromPath(
    join(options.directory, 'vsual-logo.png'),
  );
  if (icon.isEmpty()) {
    settings.dispose();
    window.destroy();
    throw new Error('Desktop icon is missing. Build VSual again.');
  }
  tray = new Tray(icon.resize({ width: 32, height: 32 }));
  tray.on('click', show);
  publish(state);
  const checkSender = (event: IpcMainInvokeEvent) => {
    if (
      disposed ||
      !trustedDesktopSender(
        event.sender === window.webContents,
        event.senderFrame === window.webContents.mainFrame,
        event.senderFrame?.url,
      )
    )
      throw new Error('Desktop request is not allowed');
  };
  ipcMain.handle('desktop:state', (event, ...args: unknown[]) => {
    checkSender(event);
    if (args.length) throw new Error('Invalid desktop request');
    return settings.snapshot();
  });
  ipcMain.handle('desktop:preferences', (event, ...args: unknown[]) => {
    checkSender(event);
    if (args.length !== 1) throw new Error('Invalid desktop request');
    return settings.update(args[0]);
  });
  ipcMain.handle('desktop:hide', (event, ...args: unknown[]) => {
    checkSender(event);
    if (args.length) throw new Error('Invalid desktop request');
    hide();
  });
  ipcMain.handle('desktop:quit', (event, ...args: unknown[]) => {
    checkSender(event);
    if (args.length) throw new Error('Invalid desktop request');
    setImmediate(options.quit);
  });

  await window.loadURL(DESKTOP_URL);
  ready = true;
  if (pendingActivation) show();
  return {
    window,
    settings,
    show,
    hide,
    dispose() {
      if (disposed) return;
      disposed = true;
      settings.dispose();
      tray?.destroy();
      for (const action of ['state', 'preferences', 'hide', 'quit'])
        ipcMain.removeHandler(`desktop:${action}`);
      desktopSession.protocol.unhandle('vsual');
      if (!window.isDestroyed()) window.destroy();
    },
  };
}
