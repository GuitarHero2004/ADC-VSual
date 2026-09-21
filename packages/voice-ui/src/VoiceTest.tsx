'use client';

import {
  SPEECH_TEXT_MAX_LENGTH,
  unicodeLength,
  type UiLanguage,
} from '@adc/contracts';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { browserDependencies } from './browser.ts';
import { VoiceController, type VoiceTransport } from './controller.ts';
import { UsageLimitNotice } from './UsageLimitNotice.tsx';
import {
  errorText,
  labels,
  noticeText,
  questionNoticeText,
} from './strings.ts';

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
  /** Keep the voice controller mounted while preferences appear in Settings. */
  preferencesTarget?: HTMLElement | null;
  questionActions?: ReactNode;
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
      { silenceAutoFinish: props.mode === 'question' },
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
  }, [props.sessionKey, preferencesKey, props.mode]);
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
  preferencesTarget,
  questionActions,
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
  const focusedAction = useRef<HTMLElement | null>(null);
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

  useLayoutEffect(() => {
    // Results only announce status. Recover focus solely when its control was removed.
    const previous = focusedAction.current;
    if (
      previous &&
      !previous.isConnected &&
      document.activeElement === document.body &&
      !surfaceRef.current?.closest('[hidden]')
    ) {
      focusedAction.current = null;
      (busy ? cancelRef : startRef).current?.focus();
    }
  }, [busy, snapshot.phase]);

  function cancel() {
    controller.cancel();
    startRef.current?.focus();
  }

  const preferences = (
    <fieldset disabled={disabled} className="voice-preferences">
      <legend>
        {mode === 'question' ? t.recordingLanguage : t.recognitionLanguage}
      </legend>
      <label className="voice-sr-only" htmlFor={`${id}-recognition`}>
        {mode === 'question' ? t.recordingLanguage : t.recognitionLanguage}
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
        {mode === 'question' ? t.answerLanguageHelp : t.languageHelp}
      </p>
      {mode === 'question' && (
        <label className="voice-checkbox">
          <input
            type="checkbox"
            checked={snapshot.audioFeedback}
            onChange={(event) =>
              controller.setAudioFeedback(event.target.checked)
            }
          />
          {t.questionCues}
        </label>
      )}
    </fieldset>
  );

  const transcript = (
    <div className="voice-composer">
      {mode === 'question' ? (
        <h2 id={`${id}-heading`}>
          <label htmlFor={`${id}-transcript`}>{t.questionHeading}</label>
        </h2>
      ) : (
        <label htmlFor={`${id}-transcript`}>{t.transcript}</label>
      )}
      <textarea
        ref={transcriptRef}
        id={`${id}-transcript`}
        rows={4}
        value={snapshot.text}
        disabled={disabled}
        aria-invalid={count > SPEECH_TEXT_MAX_LENGTH || undefined}
        aria-describedby={`${id}-text-help ${id}-count`}
        onChange={(event) => controller.editText(event.target.value)}
      />
      <p id={`${id}-text-help`} className="voice-help">
        {mode === 'question' ? t.questionHelp : t.transcriptHelp}
      </p>
      <p id={`${id}-count`} className="voice-help">
        {count} / {SPEECH_TEXT_MAX_LENGTH}{' '}
        {mode === 'question' ? t.questionCharacters : t.characters}
        {count > SPEECH_TEXT_MAX_LENGTH
          ? `. ${mode === 'question' ? t.questionTooLong : t.tooLong}`
          : ''}
      </p>
    </div>
  );

  return (
    <section
      ref={surfaceRef}
      className="voice-test"
      lang={language}
      aria-labelledby={`${id}-heading`}
    >
      {mode === 'test' && <h2 id={`${id}-heading`}>{t.heading}</h2>}
      {mode === 'test' && <p>{t.explanation}</p>}
      {mode === 'question' && transcript}
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
          ? mode === 'question'
            ? t.questionUnavailable
            : t.unavailable
          : snapshot.errorCode
            ? errorText(language, snapshot.errorCode, snapshot.errorOperation)
            : mode === 'question'
              ? questionNoticeText(language, snapshot.notice)
              : noticeText(language, snapshot.notice)}
      </div>

      {snapshot.errorUsage && snapshot.errorOperation && (
        <UsageLimitNotice
          usage={snapshot.errorUsage}
          language={language}
          operation={snapshot.errorOperation}
        />
      )}

      {preferencesTarget === undefined
        ? preferences
        : preferencesTarget && createPortal(preferences, preferencesTarget)}
      <div className="voice-recording">
        <p id={`${id}-microphone`} className="voice-help">
          {mode === 'question' ? t.questionMicrophone : t.microphone}
        </p>
        {mode === 'question' && snapshot.silenceSecondsRemaining !== null && (
          // Keep ticking numbers outside the status region. Screen readers can
          // inspect them, without announcing every second into an open mic.
          <p className="voice-help voice-silence-countdown" aria-live="off">
            {t.questionCountdown.replace(
              '{seconds}',
              String(snapshot.silenceSecondsRemaining),
            )}
          </p>
        )}
        <div className="voice-controls">
          {mode === 'question' && questionActions}
          <button
            ref={startRef}
            type="button"
            className={mode === 'test' ? 'voice-primary' : undefined}
            disabled={
              disabled ||
              (busy && !(mode === 'question' && snapshot.phase === 'recording'))
            }
            aria-describedby={`${id}-microphone`}
            onClick={() => {
              if (mode === 'question' && snapshot.phase === 'recording')
                controller.finish();
              else void controller.start();
            }}
          >
            {mode === 'question'
              ? snapshot.phase === 'recording'
                ? t.questionStop
                : t.questionRecord
              : t.start}
          </button>
          {mode === 'test' && snapshot.phase === 'recording' && (
            <button
              type="button"
              onFocus={(event) => {
                focusedAction.current = event.currentTarget;
              }}
              onBlur={() => {
                focusedAction.current = null;
              }}
              onClick={() => controller.finish()}
            >
              {t.finish}
            </button>
          )}
          {busy && (
            <button
              ref={cancelRef}
              type="button"
              disabled={disabled}
              onFocus={(event) => {
                focusedAction.current = event.currentTarget;
              }}
              onBlur={() => {
                focusedAction.current = null;
              }}
              onClick={cancel}
            >
              {snapshot.phase === 'recording' ||
              snapshot.phase === 'requesting_permission'
                ? t.cancelRecording
                : t.cancel}
            </button>
          )}
        </div>
      </div>
      {mode === 'test' && transcript}
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
        {mode === 'question' ? t.questionClear : t.clear}
      </button>
      <p className="voice-privacy">
        {mode === 'question' ? t.questionProcessing : t.processing}
      </p>
      <details className="voice-privacy">
        <summary>{t.privacyDetails}</summary>
        <p>{mode === 'question' ? t.questionPrivacy : t.privacy}</p>
        {mode === 'test' && <p>{t.replayHelp}</p>}
        <p>{t.cancellation}</p>
        <a
          href="https://elevenlabs.io/privacy-policy"
          target="_blank"
          rel="noreferrer"
        >
          {t.privacyLink}
        </a>
      </details>
    </section>
  );
}
