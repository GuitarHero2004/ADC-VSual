'use client';

import {
  SPEECH_TEXT_MAX_LENGTH,
  unicodeLength,
  type UiLanguage,
} from '@adc/contracts';
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { browserDependencies } from './browser.ts';
import { VoiceController, type VoiceTransport } from './controller.ts';
import { errorText, labels, noticeText } from './strings.ts';

export interface VoiceTestProps {
  transport: VoiceTransport;
  sessionKey: string;
  uiLanguage?: UiLanguage;
  onUiLanguageChange?: (language: UiLanguage) => void;
  onReady?: (activate: () => void, cancel: () => void) => void | (() => void);
  disabled?: boolean;
  preferencesKey?: string;
  mode?: 'test' | 'question';
  onController?: (controller: VoiceController) => void | (() => void);
}

function readPreferences(controller: VoiceController, key: string): UiLanguage {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    if (!saved || typeof saved !== 'object') return 'en';
    if (
      'language' in saved &&
      (saved.language === 'vi' ||
        saved.language === 'en' ||
        saved.language === 'auto')
    )
      controller.setLanguage(saved.language);
    if ('playbackRate' in saved && typeof saved.playbackRate === 'number')
      controller.setPlaybackRate(saved.playbackRate);
    if ('speechEnabled' in saved && typeof saved.speechEnabled === 'boolean')
      controller.setSpeechEnabled(saved.speechEnabled);
    if ('audioFeedback' in saved && typeof saved.audioFeedback === 'boolean')
      controller.setAudioFeedback(saved.audioFeedback);
    return 'uiLanguage' in saved && saved.uiLanguage === 'vi' ? 'vi' : 'en';
  } catch {
    return 'en';
  }
}

/** Separate sessions mount fresh controllers so logout releases all transient data. */
export function VoiceTest(props: VoiceTestProps) {
  const preferencesKey = props.preferencesKey ?? 'adc.voice.preferences';
  const transportRef = useRef(props.transport);
  transportRef.current = props.transport;
  const [mounted, setMounted] = useState<{
    controller: VoiceController;
    language: UiLanguage;
  } | null>(null);
  useEffect(() => {
    const controller = new VoiceController(
      {
        transcribe: (...args) => transportRef.current.transcribe(...args),
        speak: (...args) => transportRef.current.speak(...args),
      },
      browserDependencies,
    );
    const language = readPreferences(controller, preferencesKey);
    setMounted({ controller, language });
    const clear = () => controller.clear();
    const visibility = () => {
      if (document.hidden) controller.cancel();
    };
    window.addEventListener('pagehide', clear);
    window.addEventListener('beforeunload', clear);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('beforeunload', clear);
      document.removeEventListener('visibilitychange', visibility);
      controller.dispose();
    };
  }, [props.sessionKey, preferencesKey]);
  if (!mounted)
    return <p role="status">{labels(props.uiLanguage ?? 'en').loading}</p>;
  return (
    <VoiceSurface
      {...props}
      preferencesKey={preferencesKey}
      controller={mounted.controller}
      initialLanguage={mounted.language}
    />
  );
}

function VoiceSurface({
  controller,
  initialLanguage,
  uiLanguage,
  onUiLanguageChange,
  onReady,
  disabled = false,
  preferencesKey,
  mode = 'test',
  onController,
}: VoiceTestProps & {
  controller: VoiceController;
  initialLanguage: UiLanguage;
  preferencesKey: string;
}) {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [localLanguage, setLocalLanguage] = useState(initialLanguage);
  const language = uiLanguage ?? localLanguage;
  const t = labels(language);
  const id = useId();
  const surfaceRef = useRef<HTMLElement>(null);
  const transcriptRef = useRef<HTMLTextAreaElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const finishRef = useRef<HTMLButtonElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const previousPhase = useRef(snapshot.phase);
  const count = unicodeLength(snapshot.text);
  const busy = [
    'requesting_permission',
    'recording',
    'transcribing',
    'generating',
  ].includes(snapshot.phase);

  useEffect(() => onController?.(controller), [controller, onController]);

  useEffect(() => {
    const surface = surfaceRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      // The companion owns aggregate cancellation, including answer speech.
      if (mode === 'question') return;
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      controller.cancel();
      startRef.current?.focus();
    };
    surface?.addEventListener('keydown', onKeyDown);
    return () => surface?.removeEventListener('keydown', onKeyDown);
  }, [controller, mode]);

  useEffect(() => {
    if (disabled) {
      if (
        [
          'requesting_permission',
          'recording',
          'transcribing',
          'generating',
          'speaking',
        ].includes(controller.getSnapshot().phase)
      )
        controller.cancel();
      return;
    }
    return onReady?.(controller.activate, controller.cancel);
  }, [controller, onReady, disabled]);

  useEffect(() => {
    try {
      localStorage.setItem(
        preferencesKey,
        JSON.stringify({
          language: snapshot.language,
          playbackRate: snapshot.playbackRate,
          speechEnabled: snapshot.speechEnabled,
          audioFeedback: snapshot.audioFeedback,
          uiLanguage: language,
        }),
      );
    } catch {
      /* Preferences are optional when browser storage is unavailable. */
    }
  }, [
    preferencesKey,
    snapshot.language,
    snapshot.playbackRate,
    snapshot.speechEnabled,
    snapshot.audioFeedback,
    language,
  ]);

  useEffect(() => {
    const previous = previousPhase.current;
    previousPhase.current = snapshot.phase;
    if (snapshot.phase === 'recording' && previous !== 'recording')
      finishRef.current?.focus();
    if (previous === 'transcribing' && snapshot.phase === 'ready')
      transcriptRef.current?.focus();
    if (previous === 'recording' && snapshot.phase === 'transcribing')
      cancelRef.current?.focus();
    if (snapshot.phase === 'error' && previous !== 'error')
      startRef.current?.focus();
    if (snapshot.phase === 'cancelled' && previous !== 'cancelled')
      startRef.current?.focus();
    if (
      snapshot.phase === 'ready' &&
      (previous === 'speaking' || previous === 'generating')
    )
      playRef.current?.focus();
  }, [snapshot.phase]);

  function cancel() {
    controller.cancel();
    startRef.current?.focus();
  }

  return (
    <section
      ref={surfaceRef}
      className="voice-test"
      lang={language}
      aria-labelledby={`${id}-heading`}
    >
      <h2 id={`${id}-heading`}>
        {mode === 'question'
          ? language === 'vi'
            ? 'Câu hỏi của bạn'
            : 'Your question'
          : t.heading}
      </h2>
      <p>
        {mode === 'question'
          ? language === 'vi'
            ? 'Nhập hoặc ghi âm, xem lại rồi chọn Hỏi VSual. Kết thúc ghi âm không tự gửi câu hỏi.'
            : 'Type or record, review the text, then choose Ask VSual. Finishing a recording does not submit your question.'
          : t.explanation}
      </p>
      {(uiLanguage === undefined || onUiLanguageChange) && (
        <>
          <label htmlFor={`${id}-interface`}>{t.uiLanguage}</label>
          <select
            id={`${id}-interface`}
            value={language}
            onChange={(event) => {
              const next = event.target.value === 'vi' ? 'vi' : 'en';
              setLocalLanguage(next);
              onUiLanguageChange?.(next);
            }}
          >
            <option value="en" lang="en">
              English
            </option>
            <option value="vi" lang="vi">
              Tiếng Việt
            </option>
          </select>
        </>
      )}

      <div className="voice-status" role="status" aria-atomic="true">
        {disabled
          ? t.unavailable
          : snapshot.errorCode
            ? errorText(language, snapshot.errorCode)
            : noticeText(language, snapshot.notice)}
      </div>

      <fieldset disabled={disabled}>
        <legend>{t.recognitionLanguage}</legend>
        <label className="voice-sr-only" htmlFor={`${id}-recognition`}>
          {t.recognitionLanguage}
        </label>
        <select
          id={`${id}-recognition`}
          value={snapshot.language}
          aria-describedby={`${id}-language-help`}
          onChange={(event) =>
            controller.setLanguage(
              event.target.value === 'vi'
                ? 'vi'
                : event.target.value === 'en'
                  ? 'en'
                  : 'auto',
            )
          }
        >
          <option value="auto">{t.auto}</option>
          <option value="en" lang="en">
            English
          </option>
          <option value="vi" lang="vi">
            Tiếng Việt
          </option>
        </select>
        <p id={`${id}-language-help`} className="voice-help">
          {t.languageHelp}
        </p>
        <p id={`${id}-microphone`} className="voice-help">
          {t.microphone}
        </p>
        <div className="voice-controls">
          <button
            ref={startRef}
            type="button"
            className="voice-primary"
            disabled={busy}
            aria-describedby={`${id}-microphone`}
            onClick={() => {
              void controller.start();
            }}
          >
            {t.start}
          </button>
          {snapshot.phase === 'recording' && (
            <button
              ref={finishRef}
              type="button"
              onClick={() => controller.finish()}
            >
              {t.finish}
            </button>
          )}
          {busy && (
            <button ref={cancelRef} type="button" onClick={cancel}>
              {snapshot.phase === 'recording' ||
              snapshot.phase === 'requesting_permission'
                ? t.cancelRecording
                : t.cancel}
            </button>
          )}
        </div>
      </fieldset>

      <label htmlFor={`${id}-transcript`}>
        {mode === 'question'
          ? language === 'vi'
            ? 'Câu hỏi có thể chỉnh sửa'
            : 'Editable question'
          : t.transcript}
      </label>
      <textarea
        ref={transcriptRef}
        id={`${id}-transcript`}
        rows={5}
        value={snapshot.text}
        disabled={disabled}
        aria-describedby={`${id}-text-help ${id}-count`}
        onChange={(event) => controller.editText(event.target.value)}
      />
      <p id={`${id}-text-help`} className="voice-help">
        {mode === 'question'
          ? language === 'vi'
            ? 'So sánh số đơn hoàn thành giữa hai tháng trên bảng được hỗ trợ.'
            : 'Compare completed-order counts between two months on the supported table.'
          : t.transcriptHelp}
      </p>
      <p id={`${id}-count`} className="voice-help">
        {count} / {SPEECH_TEXT_MAX_LENGTH} {t.characters}
        {count > SPEECH_TEXT_MAX_LENGTH ? `. ${t.tooLong}` : ''}
      </p>
      {mode === 'test' && (
        <fieldset disabled={disabled}>
          <legend>{t.read}</legend>
          <label className="voice-checkbox">
            <input
              type="checkbox"
              checked={snapshot.speechEnabled}
              onChange={(event) =>
                controller.setSpeechEnabled(event.target.checked)
              }
              aria-describedby={`${id}-speech-help`}
            />
            {t.speech}
          </label>
          <p id={`${id}-speech-help`} className="voice-help">
            {t.speechHelp}
          </p>
          <div className="voice-controls">
            <button
              type="button"
              className="voice-primary"
              disabled={
                busy ||
                !snapshot.speechEnabled ||
                !snapshot.text.trim() ||
                count > SPEECH_TEXT_MAX_LENGTH
              }
              onClick={() => {
                void controller.readBack();
              }}
            >
              {t.read}
            </button>
            <button
              ref={playRef}
              type="button"
              disabled={busy || !snapshot.speechEnabled || !snapshot.hasAudio}
              onClick={() => {
                void controller.play();
              }}
            >
              {t.play}
            </button>
            <button
              type="button"
              disabled={snapshot.phase !== 'speaking'}
              onClick={controller.stopPlayback}
            >
              {t.stop}
            </button>
          </div>
          <label htmlFor={`${id}-speed`}>{t.speed}</label>
          <select
            id={`${id}-speed`}
            value={snapshot.playbackRate}
            onChange={(event) =>
              controller.setPlaybackRate(Number(event.target.value))
            }
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
              <option value={rate} key={rate}>
                {rate}×
              </option>
            ))}
          </select>
          <p className="voice-help">{t.replayHelp}</p>
          <label className="voice-checkbox">
            <input
              type="checkbox"
              checked={snapshot.audioFeedback}
              onChange={(event) =>
                controller.setAudioFeedback(event.target.checked)
              }
            />
            {t.cues}
          </label>
        </fieldset>
      )}
      <button
        type="button"
        disabled={disabled || (!snapshot.text && !snapshot.hasAudio && !busy)}
        onClick={() => {
          controller.clear();
          transcriptRef.current?.focus();
        }}
      >
        {t.clear}
      </button>
      <p className="voice-help">{t.cancellation}</p>
      <p className="voice-privacy">
        {mode === 'question'
          ? language === 'vi'
            ? 'Kết thúc ghi âm sẽ gửi bản ghi đến ElevenLabs để chuyển thành câu hỏi có thể chỉnh sửa. Chưa tự gửi câu hỏi đến AI. Bản ghi không được lưu vào Supabase; ElevenLabs áp dụng chính sách lưu giữ riêng.'
            : 'Finishing sends your recording to ElevenLabs to fill the editable question. It does not submit the question to AI. Recordings are not saved to Supabase; ElevenLabs applies its own retention policy.'
          : t.privacy}{' '}
        <a
          href="https://elevenlabs.io/privacy-policy"
          target="_blank"
          rel="noreferrer"
        >
          {t.privacyLink}
        </a>
      </p>
    </section>
  );
}
