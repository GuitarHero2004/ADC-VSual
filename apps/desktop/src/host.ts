import {
  BrowserWindow,
  Menu,
  Tray,
  globalShortcut,
  ipcMain,
  nativeImage,
  session,
  desktopCapturer,
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
import { DesktopAuth, DesktopAuthError } from './auth.ts';
import { readDesktopConfiguration } from './config.ts';
import { DesktopAssistant, DesktopRequestError } from './assistant.ts';
import { z } from 'zod';
import { readForegroundWindow } from './foreground.ts';
import { DesktopActivation } from './activation.ts';

export interface DesktopHostOptions {
  directory: string;
  userData: string;
  quit(): void;
  /** Injected only by controlled runtime checks; normal app uses native fetch. */
  transport?: typeof fetch;
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
    reply({
      cancel:
        rendererAsset(details.url, rendererDirectory) === null &&
        !details.url.startsWith('blob:vsual://desktop/'),
    });
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
            "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; media-src blob:; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });

  const window = new BrowserWindow({
    title: 'VSual — Screen companion',
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

  let publishedAccount = false;
  const stopWork = () => {
    assistant.suspend();
    if (!window.isDestroyed()) window.webContents.send('assistant:suspend');
  };
  const suspend = () => {
    activation.invalidate();
    stopWork();
  };
  const configuration = () => readDesktopConfiguration(process.env);
  const auth = new DesktopAuth(
    configuration,
    () => {
      // An initial password sign-in also resets auth. Preserve the metadata
      // selected before sign-in, but never preserve another account's target.
      activation.invalidate(publishedAccount);
      assistant.reset();
      stopWork();
    },
    options.transport ? { fetch: options.transport } : {},
  );
  const assistant = new DesktopAssistant({
    auth,
    configuration,
    ...(options.transport ? { fetch: options.transport } : {}),
    sources: () =>
      desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      }),
    excludedSourceId: () => window.getMediaSourceId(),
  });
  const nativeAssistant = assistant;
  const removeAuthListener = auth.subscribe((state) => {
    publishedAccount = state.account !== null;
    if (!window.isDestroyed())
      window.webContents.send('assistant:session', state);
  });
  const ownsMediaFrame = (
    contents: Electron.WebContents | null,
    url: string | undefined,
    mainFrame: boolean,
  ) => contents === window.webContents && mainFrame && url === DESKTOP_URL;
  desktopSession.setPermissionCheckHandler(
    (contents, permission, _origin, details) => {
      if (!ownsMediaFrame(contents, details.requestingUrl, details.isMainFrame))
        return false;
      if (permission === 'display-capture')
        return nativeAssistant.hasCaptureGrant();
      return (
        permission === 'media' &&
        details.mediaType === 'audio' &&
        auth.snapshot().phase === 'signed_in' &&
        auth.snapshot().workspace === 'allowed'
      );
    },
  );
  desktopSession.setPermissionRequestHandler(
    (contents, permission, reply, details) => {
      if (!ownsMediaFrame(contents, details.requestingUrl, details.isMainFrame))
        return reply(false);
      if (permission === 'display-capture')
        return reply(nativeAssistant.hasCaptureGrant());
      const types = 'mediaTypes' in details ? details.mediaTypes : undefined;
      // Electron 44 asks for display capture as media with an empty mediaTypes list;
      // the display handler below then grants only the reserved window, without audio.
      if (permission === 'media' && types?.length === 0)
        return reply(nativeAssistant.hasCaptureGrant());
      reply(
        permission === 'media' &&
          !!types?.length &&
          types.every((type) => type === 'audio') &&
          auth.snapshot().phase === 'signed_in' &&
          auth.snapshot().workspace === 'allowed',
      );
    },
  );
  desktopSession.setDisplayMediaRequestHandler((request, reply) => {
    if (
      request.frame !== window.webContents.mainFrame ||
      request.frame?.url !== DESKTOP_URL ||
      !request.videoRequested ||
      request.audioRequested
    )
      return reply({});
    void nativeAssistant.claimCaptureSource().then(
      (source) => reply(source ? { video: source } : {}),
      () => reply({}),
    );
  });

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
    // Windows' default floating level is moved behind the taskbar on focus.
    // Keep this compact companion topmost even when the taskbar isn't topmost.
    window.setAlwaysOnTop(true, 'pop-up-menu');
    window.webContents.send('desktop:activated');
  };
  const activation = new DesktopActivation({
    foreground: readForegroundWindow,
    ownSource: () => window.getMediaSourceId(),
    stopWork,
    show,
  });
  const activate = () => {
    if (disposed || window.isDestroyed()) return Promise.resolve();
    return activation.activate();
  };
  const hide = () => {
    if (disposed || window.isDestroyed()) return;
    suspend();
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
        { label: vi ? 'Mở VSual' : 'Open VSual', click: () => void activate() },
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
    () => void activate(),
    publish,
  );
  const state = await settings.initialize();
  // A real tray icon is required before enabling close-to-tray.
  const icon = nativeImage.createFromPath(
    join(options.directory, 'vsual-logo.png'),
  );
  if (icon.isEmpty()) {
    settings.dispose();
    removeAuthListener();
    nativeAssistant.dispose();
    auth.dispose();
    window.destroy();
    throw new Error('Desktop icon is missing. Build VSual again.');
  }
  tray = new Tray(icon.resize({ width: 32, height: 32 }));
  tray.on('click', () => void activate());
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

  const assistantChannels: string[] = [];
  const handle = (
    name: string,
    count: number,
    action: (args: unknown[]) => unknown,
  ) => {
    const channel = `assistant:${name}`;
    assistantChannels.push(channel);
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      try {
        checkSender(event);
        if (args.length !== count) throw new Error('Invalid argument count');
        return { ok: true, value: await action(args) };
      } catch (error) {
        const safe =
          error instanceof DesktopRequestError ||
          error instanceof DesktopAuthError;
        return {
          ok: false,
          error: {
            code: safe ? error.code : 'INVALID_INPUT',
            message: safe
              ? error.message
              : 'The desktop request could not be completed.',
            ...(error instanceof DesktopRequestError
              ? { requestId: error.requestId, usage: error.usage }
              : {}),
          },
        };
      }
    });
  };
  handle('session', 0, () => auth.snapshot());
  handle('signin', 2, ([email, password]) =>
    auth.signIn(
      z.string().email().max(320).parse(email),
      z.string().min(1).max(1024).parse(password),
    ),
  );
  handle('retry', 0, () => auth.retry());
  handle('signout', 0, () => {
    activation.invalidate(true);
    return auth.signOut();
  });
  handle('active-source', 0, async () => {
    const revision = activation.revision;
    const source = await nativeAssistant.sourceForNative(activation.nativeId);
    return revision === activation.revision ? source : null;
  });
  handle('prepare', 2, ([source, id]) =>
    nativeAssistant.prepareCapture(z.uuid().parse(source), z.uuid().parse(id)),
  );
  handle('screen', 1, ([input]) =>
    nativeAssistant.readScreen(
      input as Parameters<DesktopAssistant['readScreen']>[0],
    ),
  );
  handle('transcribe', 1, ([input]) =>
    nativeAssistant.transcribe(
      input as Parameters<DesktopAssistant['transcribe']>[0],
    ),
  );
  handle('speak', 1, ([input]) =>
    nativeAssistant.speak(input as Parameters<DesktopAssistant['speak']>[0]),
  );
  handle('cancel', 1, ([id]) => nativeAssistant.cancel(z.uuid().parse(id)));

  await window.loadURL(DESKTOP_URL);
  ready = true;
  if (pendingActivation) show();
  return {
    window,
    settings,
    activate,
    show,
    hide,
    dispose() {
      if (disposed) return;
      disposed = true;
      activation.invalidate(true);
      settings.dispose();
      removeAuthListener();
      nativeAssistant.dispose();
      auth.dispose();
      tray?.destroy();
      for (const action of ['state', 'preferences', 'hide', 'quit'])
        ipcMain.removeHandler(`desktop:${action}`);
      for (const channel of assistantChannels) ipcMain.removeHandler(channel);
      desktopSession.protocol.unhandle('vsual');
      if (!window.isDestroyed()) window.destroy();
    },
  };
}
