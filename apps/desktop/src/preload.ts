import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { DesktopBridge, DesktopState } from './bridge.ts';

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
};
contextBridge.exposeInMainWorld('vsualDesktop', bridge);
