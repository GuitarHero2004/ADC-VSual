import type {
  UiLanguage,
  RecognitionLanguage,
  TranscriptResponse,
  DesktopResponse,
} from '@adc/contracts';
import type { DesktopSessionState } from './session-types.ts';

export const DESKTOP_SHORTCUTS = [
  'Control+Alt+Space',
  'Control+Alt+V',
  'Control+Shift+Space',
] as const;
export type DesktopShortcut = (typeof DESKTOP_SHORTCUTS)[number];
export interface DesktopPreferences {
  language: UiLanguage;
  shortcut: DesktopShortcut;
}
export interface DesktopState {
  preferences: DesktopPreferences;
  shortcutRegistered: boolean;
  preferencesSaved: boolean;
  issue: 'shortcut_unavailable' | 'preferences_not_saved' | null;
}
export const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  language: 'en',
  shortcut: DESKTOP_SHORTCUTS[0],
};

export function parseDesktopPreferences(input: unknown): DesktopPreferences {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid desktop preferences');
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).length !== 2 ||
    (value.language !== 'en' && value.language !== 'vi') ||
    !DESKTOP_SHORTCUTS.some((shortcut) => shortcut === value.shortcut)
  )
    throw new Error('Invalid desktop preferences');
  return {
    language: value.language,
    shortcut: value.shortcut as DesktopShortcut,
  };
}

export interface DesktopBridge {
  getState(): Promise<DesktopState>;
  updatePreferences(preferences: DesktopPreferences): Promise<DesktopState>;
  hide(): Promise<void>;
  quit(): Promise<void>;
  onState(listener: (state: DesktopState) => void): () => void;
  onActivate(listener: () => void): () => void;
  getSession(): Promise<DesktopSessionState>;
  signIn(email: string, password: string): Promise<DesktopSessionState>;
  retrySession(): Promise<DesktopSessionState>;
  signOut(): Promise<DesktopSessionState>;
  onSession(listener: (state: DesktopSessionState) => void): () => void;
  onSuspend(listener: () => void): () => void;
  getActiveSource(): Promise<DesktopSource | null>;
  prepareCapture(
    sourceId: string,
    requestId: string,
  ): Promise<DesktopCaptureTicket>;
  readScreen(input: DesktopScreenInput): Promise<DesktopResponse>;
  transcribe(input: DesktopTranscribeInput): Promise<TranscriptResponse>;
  speak(input: DesktopSpeakInput): Promise<ArrayBuffer>;
  cancelOperation(requestId: string): Promise<void>;
}

export interface DesktopSource {
  id: string;
  title: string;
}
export interface DesktopCaptureTicket extends DesktopSource {
  captureId: string;
  requestId: string;
  epoch: string;
}
export interface DesktopScreenInput {
  captureId: string;
  requestId: string;
  question: string;
  bytes: ArrayBuffer;
  width: number;
  height: number;
  capturedAt: string;
}
export interface DesktopTranscribeInput {
  requestId: string;
  bytes: ArrayBuffer;
  mimeType: string;
  filename: string;
  language: RecognitionLanguage;
}
export interface DesktopSpeakInput {
  requestId: string;
  text: string;
  language: RecognitionLanguage;
}

declare global {
  interface Window {
    vsualDesktop: DesktopBridge;
  }
}
