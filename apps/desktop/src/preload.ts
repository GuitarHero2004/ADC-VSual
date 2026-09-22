import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { DesktopBridge, DesktopState } from './bridge.ts';
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

// Install before React loads so activation during a cold start is not lost.
// One queued delivery also survives Strict Mode subscribe/unsubscribe cycles.
const activationListeners = new Set<() => void>();
let pendingActivation = false;
let deliveryScheduled = false;
function deliverActivation() {
  if (deliveryScheduled) return;
  deliveryScheduled = true;
  queueMicrotask(() => {
    deliveryScheduled = false;
    if (!pendingActivation || activationListeners.size === 0) return;
    pendingActivation = false;
    for (const listener of activationListeners) listener();
  });
}
ipcRenderer.on('desktop:activated', () => {
  pendingActivation = true;
  deliverActivation();
});

// Expose fixed capabilities; never expose Electron, event objects or raw invoke.
const bridge: DesktopBridge = {
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
