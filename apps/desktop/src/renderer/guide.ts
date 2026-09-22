import type { UiLanguage } from '@adc/contracts';
import { pronounceBrand } from '@adc/voice-ui/speech-pronunciation';
import type { DesktopBridge, DesktopShortcut } from '../bridge.ts';
import type { DesktopSessionState } from '../session-types.ts';
import { COMPANION_PLAYBACK_RATE } from '../../../../packages/voice-ui/src/controller.ts';

export const guideCopy = {
  en: {
    title: 'Welcome to VSual',
    spokenIntroduction:
      'I explain what is visible in your application. Return to the app you want to ask about.',
    startTalk: 'Press this shortcut, wait for the listening sound, then speak.',
    talkUnavailable:
      'The Talk shortcut is unavailable. Choose another shortcut in Settings and save. Typed questions remain available.',
    spokenInstructions:
      'Pause five seconds to send; speaking again resets the countdown. Stop and review lets you edit before sending. Inside VSual, Tab and Shift Tab move between controls; Enter or Space activates a button. Escape hides VSual and stops work.',
    hear: 'Hear instructions again',
    stop: 'Stop introduction',
    loading: 'Preparing the Windows voice.',
    speaking: 'Reading the introduction. You can stop it at any time.',
    stopped: 'Introduction stopped.',
    complete: 'Introduction finished.',
    blocked: 'The written instructions remain available.',
    unavailable:
      'No local Windows voice is available for English. The written instructions remain available.',
    failed:
      'The Windows voice could not play. Read the instructions below or try Hear instructions again.',
    provider:
      'Instructions use the default available local Windows voice for this language. No instructions are sent to a speech provider. Answers still use your configured ElevenLabs voice.',
    talk: 'Talk shortcut',
    stopShortcut: 'Stop shortcut',
    stopUnavailable:
      'The Stop shortcut is unavailable. Use the Stop controls in VSual or Escape to hide and stop.',
  },
  vi: {
    title: 'Chào mừng đến với VSual',
    spokenIntroduction:
      'Tôi giải thích nội dung đang hiển thị trong ứng dụng. Quay lại ứng dụng bạn muốn hỏi.',
    startTalk: 'Nhấn phím tắt này, chờ âm báo, rồi đặt câu hỏi.',
    talkUnavailable:
      'Không dùng được phím tắt Nói. Chọn phím khác trong Cài đặt rồi lưu. Bạn vẫn có thể nhập câu hỏi.',
    spokenInstructions:
      'Ngừng nói năm giây để gửi. Nói tiếp đặt lại thời gian chờ. Dừng và xem lại cho phép chỉnh sửa trước khi gửi. Trong VSual, Tab và Shift Tab di chuyển giữa các điều khiển; Enter hoặc Space kích hoạt nút. Escape ẩn VSual và dừng công việc.',
    hear: 'Nghe lại hướng dẫn',
    stop: 'Dừng lời giới thiệu',
    loading: 'Đang chuẩn bị giọng Windows.',
    speaking: 'Đang đọc lời giới thiệu. Bạn có thể dừng bất cứ lúc nào.',
    stopped: 'Đã dừng lời giới thiệu.',
    complete: 'Đã đọc xong lời giới thiệu.',
    blocked: 'Bạn vẫn có thể đọc hướng dẫn bên dưới.',
    unavailable:
      'Không có giọng Windows cục bộ cho tiếng Việt. Bạn vẫn có thể đọc hướng dẫn bên dưới.',
    failed:
      'Không thể phát giọng Windows. Đọc hướng dẫn bên dưới hoặc thử Nghe lại hướng dẫn.',
    provider:
      'Hướng dẫn dùng giọng Windows cục bộ mặc định có sẵn cho ngôn ngữ này. Không gửi hướng dẫn đến nhà cung cấp giọng nói. Câu trả lời vẫn dùng giọng ElevenLabs đã cấu hình.',
    talk: 'Phím tắt Nói',
    stopShortcut: 'Phím tắt Dừng',
    stopUnavailable:
      'Không dùng được phím tắt Dừng. Dùng các nút Dừng trong VSual hoặc Escape để ẩn và dừng.',
  },
} as const;

export type GuidePhase =
  | 'idle'
  | 'loading'
  | 'speaking'
  | 'stopped'
  | 'complete'
  | 'blocked'
  | 'unavailable'
  | 'failed';
export interface GuideState {
  phase: GuidePhase;
}

export interface GuideDependencies {
  getVoices(): readonly SpeechSynthesisVoice[];
  createUtterance(text: string): SpeechSynthesisUtterance;
  speak(utterance: SpeechSynthesisUtterance): void;
  cancel(): void;
  onVoicesChanged(listener: () => void): () => void;
  schedule(callback: () => void, delayMs: number): () => void;
}

export function localGuideDependencies(): GuideDependencies {
  return {
    getVoices: () => window.speechSynthesis.getVoices(),
    createUtterance: (text) => new SpeechSynthesisUtterance(text),
    speak: (utterance) => window.speechSynthesis.speak(utterance),
    cancel: () => window.speechSynthesis.cancel(),
    onVoicesChanged: (listener) => {
      window.speechSynthesis.addEventListener('voiceschanged', listener);
      return () =>
        window.speechSynthesis.removeEventListener('voiceschanged', listener);
    },
    schedule: (callback, delayMs) => {
      const timer = window.setTimeout(callback, delayMs);
      return () => window.clearTimeout(timer);
    },
  };
}

export function guideSpeechText(
  language: UiLanguage,
  shortcut: DesktopShortcut,
  stopShortcut: string,
  stopRegistered: boolean,
  talkRegistered = true,
) {
  const copy = guideCopy[language];
  const keys = (value: string) => value.replaceAll('+', ', ');
  return [
    `${copy.title}.`,
    copy.spokenIntroduction,
    talkRegistered
      ? `${copy.talk}: ${keys(shortcut)}. ${copy.startTalk}`
      : copy.talkUnavailable,
    stopRegistered
      ? `${copy.stopShortcut}: ${keys(stopShortcut)}.`
      : copy.stopUnavailable,
    copy.spokenInstructions,
  ].join(' ');
}

/** Local guidance shares interruption signals with assistant work, never its provider. */
export class DesktopGuideController {
  private state: GuideState = { phase: 'blocked' };
  private listeners = new Set<() => void>();
  private generation = 0;
  private automaticReserved = false;
  private sessionKey: string | null = null;
  private cancelVoiceWait: (() => void) | null = null;
  private readonly dependencies: GuideDependencies;

  constructor(_bridge: DesktopBridge, dependencies: GuideDependencies) {
    this.dependencies = dependencies;
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(phase: GuidePhase) {
    this.state = { phase };
    for (const listener of this.listeners) listener();
  }

  private cancel() {
    this.generation++;
    this.cancelVoiceWait?.();
    this.cancelVoiceWait = null;
    try {
      this.dependencies.cancel();
    } catch {
      // An unavailable device voice must never block logout or microphone cleanup.
    }
    this.update(this.sessionKey ? 'stopped' : 'blocked');
  }

  stop = () => {
    this.automaticReserved = true;
    this.cancel();
  };

  interrupt = () => this.stop();

  /** Signing in can unlock the welcome; assistant work suppresses it. */
  beforeWork = () => {
    if (this.sessionKey) this.interrupt();
    else this.cancel();
  };

  setSession = (session: DesktopSessionState | null) => {
    const next =
      session?.phase === 'signed_in' && session.account
        ? `${session.epoch}:${session.account.id}`
        : null;
    if (next === this.sessionKey) return;
    this.sessionKey = next;
    this.cancel();
    this.update(next ? 'idle' : 'blocked');
  };

  clear = () => this.cancel();

  async automatic(text: string, language: UiLanguage) {
    if (!this.sessionKey || this.automaticReserved) return;
    // Reserve before voices load; rerenders and reopening must never repeat it.
    this.automaticReserved = true;
    await this.play(text, language);
  }

  async replay(text: string, language: UiLanguage) {
    if (
      !this.sessionKey ||
      this.state.phase === 'loading' ||
      this.state.phase === 'speaking'
    )
      return;
    this.automaticReserved = true;
    await this.play(text, language);
  }

  private findVoice(language: UiLanguage) {
    const voices = this.dependencies
      .getVoices()
      .filter(
        (voice) =>
          voice.localService &&
          voice.lang.toLowerCase().split(/[-_]/)[0] === language,
      );
    return voices.find((voice) => voice.default) ?? voices[0] ?? null;
  }

  private async waitForVoice(language: UiLanguage) {
    const available = this.findVoice(language);
    if (available) return available;
    return new Promise<SpeechSynthesisVoice | null>((resolve) => {
      let settled = false;
      let unsubscribe = () => {};
      let clearTimer = () => {};
      const finish = (voice: SpeechSynthesisVoice | null) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        clearTimer();
        this.cancelVoiceWait = null;
        resolve(voice);
      };
      this.cancelVoiceWait = () => finish(null);
      unsubscribe = this.dependencies.onVoicesChanged(() => {
        const voice = this.findVoice(language);
        if (voice) finish(voice);
      });
      clearTimer = this.dependencies.schedule(
        () => finish(this.findVoice(language)),
        1_500,
      );
      // Covers voice registration between the initial read and listener setup.
      const voice = this.findVoice(language);
      if (voice) finish(voice);
    });
  }

  private async play(text: string, language: UiLanguage) {
    this.cancel();
    const current = this.generation;
    this.update('loading');
    try {
      const voice = await this.waitForVoice(language);
      if (current !== this.generation) return;
      if (!voice) {
        this.update('unavailable');
        return;
      }
      const utterance = this.dependencies.createUtterance(pronounceBrand(text));
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = COMPANION_PLAYBACK_RATE;
      utterance.onend = () => {
        if (current === this.generation) this.update('complete');
      };
      utterance.onerror = () => {
        if (current === this.generation) this.update('failed');
      };
      this.update('speaking');
      if (current === this.generation) this.dependencies.speak(utterance);
    } catch {
      if (current === this.generation) this.update('failed');
    }
  }
}
