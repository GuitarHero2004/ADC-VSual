import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type {
  DesktopActivationEvent,
  DesktopBridge,
  DesktopState,
} from './bridge.ts';
import type { DesktopSessionState } from './session-types.ts';

async function command<T>(name: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(`assistant:${name}`, ...args)) as
    | { ok: true; value: T }
    | {
        ok: false;
        error: {
          code: string;
          message: string;
          requestId?: string;
          usage?: unknown;
        };
      };
  if (!result.ok) {
    // contextBridge drops custom properties on Error objects, including code.
    // Reject a plain record so the renderer keeps safe failure and usage details.
    throw {
      code: result.error.code,
      message: result.error.message,
      ...(typeof result.error.requestId === 'string'
        ? { requestId: result.error.requestId }
        : {}),
      ...(result.error.usage !== undefined
        ? { usage: result.error.usage }
        : {}),
    };
  }
  return result.value;
}

// Preload owns delivery until React has installed its controller and hydrated auth.
// Only main-process events can enter this queue; page messages cannot activate it.
const activationListeners = new Set<(event: DesktopActivationEvent) => void>();
let pendingActivation: DesktopActivationEvent | null = null;
let activationReady = false;
let deliveryScheduled = false;
const delivered = new Set<string>();
function deliverActivation() {
  if (deliveryScheduled) return;
  deliveryScheduled = true;
  queueMicrotask(() => {
    deliveryScheduled = false;
    if (
      !activationReady ||
      !pendingActivation ||
      activationListeners.size === 0
    )
      return;
    const event = pendingActivation;
    pendingActivation = null;
    if (delivered.has(event.id)) return;
    delivered.add(event.id);
    if (delivered.size > 32) delivered.delete(delivered.values().next().value!);
    for (const listener of activationListeners) listener(event);
  });
}
ipcRenderer.on('desktop:activated', (_event, input: unknown) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const event = input as Record<string, unknown>;
  if (
    Object.keys(event).length !== 2 ||
    typeof event.id !== 'string' ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(event.id) ||
    (event.kind !== 'open' && event.kind !== 'talk') ||
    delivered.has(event.id)
  )
    return;
  pendingActivation = { id: event.id, kind: event.kind };
  deliverActivation();
});
ipcRenderer.on('assistant:suspend', () => {
  pendingActivation = null;
});

// Expose fixed capabilities; never expose Electron, event objects or raw invoke.
const bridge: DesktopBridge = {
  async activationReady() {
    activationReady = true;
    await ipcRenderer.invoke('desktop:activation-ready');
    deliverActivation();
  },
  stopWork: () => ipcRenderer.invoke('desktop:stop'),
  getGuideSeenVersion: () => ipcRenderer.invoke('desktop:guide-version'),
  markGuideSeenVersion: (version) =>
    ipcRenderer.invoke('desktop:guide-seen', version),
  getState: () => ipcRenderer.invoke('desktop:state'),
  updatePreferences: (preferences) =>
    ipcRenderer.invoke('desktop:preferences', preferences),
  hide: () => ipcRenderer.invoke('desktop:hide'),
  quit: () => ipcRenderer.invoke('desktop:quit'),
  onState(listener) {
    const handle = (_event: IpcRendererEvent, state: DesktopState) =>
      listener(state);
    ipcRenderer.on('desktop:state-changed', handle);
    return () => ipcRenderer.removeListener('desktop:state-changed', handle);
  },
  onActivate(listener) {
    activationListeners.add(listener);
    deliverActivation();
    return () => {
      activationListeners.delete(listener);
    };
  },
  getSession: () => command('session'),
  signIn: (email, password) => command('signin', email, password),
  retrySession: () => command('retry'),
  signOut: () => command('signout'),
  getActiveSource: () => command('active-source'),
  prepareCapture: (sourceId, requestId) =>
    command('prepare', sourceId, requestId),
  readScreen: (input) => command('screen', input),
  transcribe: (input) => command('transcribe', input),
  speak: (input) => command('speak', input),
  cancelOperation: (id) => command('cancel', id),
  onSession(listener) {
    const handler = (_event: IpcRendererEvent, state: DesktopSessionState) =>
      listener(state);
    ipcRenderer.on('assistant:session', handler);
    return () => {
      ipcRenderer.removeListener('assistant:session', handler);
    };
  },
  onSuspend(listener) {
    const handler = () => listener();
    ipcRenderer.on('assistant:suspend', handler);
    return () => {
      ipcRenderer.removeListener('assistant:suspend', handler);
    };
  },
};
contextBridge.exposeInMainWorld('vsualDesktop', bridge);
