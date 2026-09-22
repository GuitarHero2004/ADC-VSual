import {
  GROUNDED_QUESTION_MAX_LENGTH,
  unicodeLength,
  VISUAL_LIMITS,
  type GroundedRow,
  type UiLanguage,
} from '@adc/contracts';
import {
  COMPANION_PLAYBACK_RATE,
  VoiceController,
  VoiceTest,
  browserDependencies,
  voiceErrorText,
  UsageLimitNotice,
  type VoiceTransport,
} from '@adc/voice-ui';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { OrdersPageContext } from './page-context.ts';
import { ordersOrigins } from './config-values.ts';
import {
  GroundedController,
  isStructuredSnapshot,
  isVisualSnapshot,
} from './grounded-controller.ts';
import { createGroundedTransport } from './grounded-transport.ts';
import { groundedText } from './grounded-strings.ts';
import {
  companionError,
  companionText,
  structuredText,
  unsupportedPageText,
} from './structured-strings.ts';
import { StructuredSource } from './StructuredSource.tsx';
import { VisualSource } from './VisualSource.tsx';
import { visualText, visualError } from './visual-strings.ts';
import { canAskPage, chooseReadingMethod } from './reading-method.ts';
import { readVisualNotice, saveVisualNotice } from './visual-notice.ts';
import {
  ANSWER_PREFERENCES_KEY,
  loadAnswerSpeech,
} from './answer-preferences.ts';

const supportedOrigins = ordersOrigins(import.meta.env);

interface Props {
  sessionKey: string;
  language: UiLanguage;
  voiceTransport: VoiceTransport;
  backend: string;
  getHeaders(): Promise<Record<string, string>>;
  onExpired(): void;
  onReady(activate: () => void, cancel: () => void): () => void;
  settingsTarget?: HTMLElement | null;
  createPage?: () => ConstructorParameters<typeof GroundedController>[0];
  continueAnswerAcrossTabs?: boolean;
  onActivity?: () => void;
  onSpeechOff?: () => void;
  onControls?: (controls: CompanionControls | null) => void;
  autoFocus?: boolean;
}
/** The two presentations share these exact session-owned controllers. */
export interface CompanionControls {
  controller: GroundedController;
  question: VoiceController;
  speech: VoiceController;
}
interface Mounted {
  controller: GroundedController;
  speech: VoiceController;
  speechDeadline: { current: number | null };
}

export function GroundedPanel(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const questionVoice = useRef<VoiceController | null>(null);
  const [mounted, setMounted] = useState<Mounted | null>(null);
  useEffect(() => {
    const speechDeadline = { current: null as number | null };
    const speech = new VoiceController(
      {
        speak: async (text, language, signal) => {
          const result = controller.getSnapshot().result;
          if (
            !result ||
            !('source_kind' in result) ||
            result.source_kind !== 'visual_page'
          )
            return latest.current.voiceTransport.speak(text, language, signal);
          const remaining =
            speechDeadline.current === null
              ? VISUAL_LIMITS.speechTimeoutMs
              : Math.min(
                  VISUAL_LIMITS.speechTimeoutMs,
                  speechDeadline.current - Date.now(),
                );
          speechDeadline.current = null;
          if (remaining <= 0)
            return Promise.reject(
              Object.assign(new Error('Speech deadline exceeded'), {
                code: 'TIMEOUT',
              }),
            );
          const timeout = AbortSignal.timeout(Math.ceil(remaining));
          const bounded = AbortSignal.any([signal, timeout]);
          try {
            const audio = await latest.current.voiceTransport.speak(
              text,
              language,
              bounded,
            );
            bounded.throwIfAborted();
            return audio;
          } catch (error) {
            if (!signal.aborted && timeout.aborted)
              throw Object.assign(new Error('Speech deadline exceeded'), {
                code: 'TIMEOUT',
              });
            throw error;
          }
        },
        transcribe: (...args) =>
          latest.current.voiceTransport.transcribe(...args),
      },
      browserDependencies,
      { fixedPlaybackRate: COMPANION_PLAYBACK_RATE },
    );
    try {
      speech.setSpeechEnabled(loadAnswerSpeech(localStorage));
    } catch {
      // Accessing localStorage itself may fail; remain OFF until chosen explicitly.
    }
    const controller = new GroundedController(
      latest.current.createPage?.() ?? new OrdersPageContext(supportedOrigins),
      createGroundedTransport({
        baseUrl: latest.current.backend,
        getHeaders: () => latest.current.getHeaders(),
        onUnauthenticated: () => latest.current.onExpired(),
      }),
      (preserveAnswerSpeech = false) => {
        if (!preserveAnswerSpeech) speech.clear();
        const voice = questionVoice.current;
        if (
          voice &&
          [
            'recording',
            'requesting_permission',
            'transcribing',
            'generating',
            'speaking',
          ].includes(voice.getSnapshot().phase)
        )
          voice.cancel();
      },
      { continueAnswerAcrossTabs: !!latest.current.continueAnswerAcrossTabs },
    );
    setMounted({ controller, speech, speechDeadline });
    void readVisualNotice(latest.current.sessionKey).then((accepted) => {
      // A slow storage read must not undo an acknowledgement made in this UI.
      if (accepted) controller.setVisualNoticeAccepted(true);
    });
    void controller.refreshContext();
    const end = () => {
      controller.clearTransient();
      questionVoice.current?.clear();
      speech.clear();
    };
    const visibility = () => {
      if (document.hidden) {
        if (latest.current.continueAnswerAcrossTabs) controller.pauseForTab();
        else end();
      }
      // The worker prepares a followed source. A passive launcher becoming
      // visible must not arm following or acquire a reader by itself.
      else void controller.refreshContext();
    };
    window.addEventListener('pagehide', end);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pagehide', end);
      document.removeEventListener('visibilitychange', visibility);
      controller.dispose();
      speech.dispose();
      questionVoice.current = null;
    };
  }, [props.sessionKey]);
  if (!mounted)
    return <p role="status">{groundedText[props.language].checking}</p>;
  return <Companion {...props} {...mounted} questionVoice={questionVoice} />;
}

function Companion({
  controller,
  speech,
  speechDeadline,
  questionVoice,
  ...props
}: Props &
  Mounted & {
    questionVoice: React.RefObject<VoiceController | null>;
  }) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const structured = state.context?.sourceKind === 'structured_page';
  const t = companionText(props.language, structured);
  const s = structuredText[props.language];
  const v = visualText[props.language];
  const audio = useSyncExternalStore(
    speech.subscribe,
    speech.getSnapshot,
    speech.getSnapshot,
  );
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [returnStatus, setReturnStatus] = useState('');
  const [heldVoiceQuestion, setHeldVoiceQuestion] = useState<
    'page' | 'length' | 'busy' | null
  >(null);
  const answerHeading = useRef<HTMLHeadingElement>(null);
  const evidenceDetails = useRef<HTMLDetailsElement>(null);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const initialFocus = useRef(false);
  const surface = useRef<HTMLDivElement>(null);
  const resultText = state.result?.text ?? '';
  const resultLanguage = state.resultLanguage ?? 'en';
  const allowed = canAskPage(state.context);
  const visualCandidate =
    !!state.context?.visual?.eligible &&
    chooseReadingMethod(state.question, state.context).method === 'visual_page';
  const [noticeStatus, setNoticeStatus] = useState('');
  const unsupportedMessage = unsupportedPageText(props.language, state.context);
  const askUnavailable = !allowed
    ? state.context?.visual?.eligible
      ? v.access
      : state.context?.permission === 'required'
        ? s.askAccess
        : s.askUnsupported
    : null;
  const busy = state.phase === 'reading' || state.phase === 'understanding';
  useEffect(() => {
    if (props.autoFocus === false || initialFocus.current || !state.context)
      return;
    initialFocus.current = true;
    // Never move focus after the user has begun interacting or opened Settings.
    if (
      document.activeElement !== document.body ||
      surface.current?.closest('[hidden]')
    )
      return;
    if (allowed)
      surface.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    else pageHeading.current?.focus();
  }, [state.context, allowed, props.autoFocus]);

  useEffect(() => {
    const element = surface.current;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      controller.cancel();
      questionVoice.current?.cancel();
      speech.cancel();
    };
    element?.addEventListener('keydown', cancel);
    return () => element?.removeEventListener('keydown', cancel);
  }, [controller, questionVoice, speech]);

  const attachVoice = useCallback(
    (voice: VoiceController) => {
      questionVoice.current = voice;
      setVoiceReady(true);
      let wasCapturing = false;
      const update = () => {
        const next = voice.getSnapshot();
        // Reserve before any other state update: only one completed recording
        // may submit, even when React/subscriptions run again.
        const automaticQuestion = voice.claimAutomaticQuestion();
        if (
          next.text !== controller.getSnapshot().question ||
          next.phase === 'cancelled'
        )
          setHeldVoiceQuestion(null);
        const capturing = [
          'requesting_permission',
          'recording',
          'transcribing',
        ].includes(next.phase);
        if (capturing && !wasCapturing) {
          // Supersede the old answer without cancelling the microphone just started.
          controller.cancel(false);
          props.onActivity?.();
        }
        wasCapturing = capturing;
        if (capturing) {
          setHeldVoiceQuestion(null);
          controller.discardAutomaticSpeech();
          speech.stopPlayback();
        }
        setVoiceBusy(capturing);
        controller.setQuestion(next.text);
        if (automaticQuestion !== null) {
          const current = controller.getSnapshot();
          if (
            !controller.busy &&
            canAskPage(current.context) &&
            unicodeLength(automaticQuestion) <= GROUNDED_QUESTION_MAX_LENGTH
          ) {
            props.onActivity?.();
            setReturnStatus('');
            setHeldVoiceQuestion(null);
            // ask() rechecks browser access, source context and backend
            // authentication before this deliberate recorded question is sent.
            void controller.ask();
          } else
            setHeldVoiceQuestion(
              !canAskPage(current.context)
                ? 'page'
                : unicodeLength(automaticQuestion) >
                    GROUNDED_QUESTION_MAX_LENGTH
                  ? 'length'
                  : 'busy',
            );
        }
      };
      const unsubscribe = voice.subscribe(update);
      update();
      return () => {
        unsubscribe();
        if (questionVoice.current === voice) questionVoice.current = null;
        setVoiceReady(false);
      };
    },
    [controller, speech, questionVoice, props.onActivity],
  );

  useEffect(() => {
    if (!voiceReady) return;
    return props.onReady(
      () => {
        if (controller.busy) controller.cancel();
        else if (
          controller.getSnapshot().question.trim() &&
          !canAskPage(controller.getSnapshot().context)
        )
          void controller.refreshContext(true);
        else if (
          ['generating', 'speaking'].includes(speech.getSnapshot().phase)
        )
          speech.cancel();
        else questionVoice.current?.activate();
      },
      () => {
        controller.cancel();
        questionVoice.current?.cancel();
        speech.cancel();
      },
    );
  }, [controller, speech, questionVoice, props.onReady, voiceReady]);

  useEffect(() => {
    const question = questionVoice.current;
    if (!voiceReady || !question) return;
    props.onControls?.({ controller, question, speech });
    return () => props.onControls?.(null);
  }, [controller, speech, questionVoice, props.onControls, voiceReady]);

  useEffect(() => {
    // Runs after the accepted text is rendered. The controller reserves the
    // fresh request once, even with multiple subscriptions or Strict Mode effects.
    const fresh = controller.claimAutomaticSpeech();
    if (!fresh) return;
    speech.setLanguage(fresh.answer_language);
    speech.editText(fresh.text);
    speechDeadline.current =
      speech.getSnapshot().speechEnabled &&
      'source_kind' in fresh &&
      fresh.source_kind === 'visual_page'
        ? controller.getSpeechDeadline()
        : null;
    if (speech.getSnapshot().speechEnabled) void speech.readBack();
  }, [controller, speech, state.result, speechDeadline]);
  useEffect(() => {
    try {
      localStorage.setItem(
        ANSWER_PREFERENCES_KEY,
        JSON.stringify({
          speechEnabled: audio.speechEnabled,
        }),
      );
    } catch {
      /* Optional non-sensitive preferences only. */
    }
  }, [audio.speechEnabled]);
  useEffect(() => {
    const updated = (event: StorageEvent) => {
      if (event.key !== ANSWER_PREFERENCES_KEY) return;
      try {
        speech.setSpeechEnabled(loadAnswerSpeech(localStorage));
      } catch {
        speech.setSpeechEnabled(false);
      }
    };
    window.addEventListener('storage', updated);
    return () => window.removeEventListener('storage', updated);
  }, [speech]);
  const status = state.error
    ? ((state.reader === 'visual_page'
        ? visualError(props.language, state.error)
        : null) ?? companionError(props.language, state.error, structured))
    : state.reader === 'visual_page' && state.phase === 'reading'
      ? v.capturing
      : state.phase === 'stale'
        ? t.previous
        : state.phase === 'ready'
          ? state.result?.status === 'answer'
            ? t.answerReady
            : state.result
              ? t.clarification
              : t.tableReady
          : state.phase === 'idle'
            ? ''
            : t[state.phase === 'error' ? 'idle' : state.phase];
  const playbackActive = ['generating', 'speaking'].includes(audio.phase);
  const focusQuestion = () =>
    surface.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
  const speechPreferences = (
    <fieldset>
      <legend>{t.playback}</legend>
      <label className="checkbox-row" htmlFor="answer-speech-enabled">
        <input
          id="answer-speech-enabled"
          type="checkbox"
          checked={audio.speechEnabled}
          onChange={(event) => {
            controller.discardAutomaticSpeech();
            speech.setSpeechEnabled(event.target.checked);
            if (!event.target.checked) props.onSpeechOff?.();
          }}
        />
        {t.speech}
      </label>
      <p>{t.speechHelp}</p>
      {props.settingsTarget && (
        <button
          type="button"
          disabled={!playbackActive}
          onClick={() => {
            controller.discardAutomaticSpeech();
            speech.stopPlayback();
          }}
        >
          {t.stop}
        </button>
      )}
    </fieldset>
  );
  return (
    <div className="grounded-panel" ref={surface} lang={props.language}>
      <section aria-labelledby="page-context-heading" className="page-context">
        <h2 id="page-context-heading" ref={pageHeading} tabIndex={-1}>
          {t.page}
        </h2>
        {state.context?.title && (
          <p className="page-title">{state.context.title}</p>
        )}
        {state.context?.origin && (
          <p className="field-help">
            {new URL(state.context.origin).host}
            {state.context.pathname ?? ''}
          </p>
        )}
        <p
          role="status"
          aria-atomic="true"
          id={structured ? 'page-permission-help' : undefined}
        >
          {state.error === 'PAGE_UNAVAILABLE'
            ? t.unavailablePage
            : state.context === null
              ? t.checking
              : state.context.reason === 'unavailable'
                ? t.unavailablePage
                : state.context.visual?.eligible && !state.context.supported
                  ? state.context.visual.permission === 'granted'
                    ? v.ready
                    : v.access
                  : !state.context.supported
                    ? structured
                      ? state.context.permission === 'required'
                        ? s.activation
                        : unsupportedMessage
                      : t.unsupported
                    : t.readyPage}
        </p>
        {structured &&
          state.context &&
          !state.context.supported &&
          !state.context.visual?.eligible &&
          state.context.permission !== 'required' && (
            <p className="field-help">{s.unsupportedHelp}</p>
          )}
        {!state.context?.supported &&
          !structured &&
          !state.context?.visual?.eligible && (
            <div id="page-permission-help">
              <p>{t.permissionHelp}</p>
              <ul>
                {supportedOrigins.map((origin) => (
                  <li key={origin}>
                    <a
                      href={`${origin}/orders`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {new URL(origin).host}/orders
                    </a>
                  </li>
                ))}
              </ul>
              <p>{t.recheckHelp}</p>
            </div>
          )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void controller.refreshContext(true)}
        >
          {t.recheck}
        </button>
      </section>
      <section
        aria-label={
          props.language === 'vi' ? 'Câu hỏi của bạn' : 'Your question'
        }
        className="question-composer"
      >
        <p className="field-help">
          {visualCandidate ? v.ready : t.processingNotice}
        </p>
        {visualCandidate && (
          <section aria-labelledby="visual-notice-heading" className="notice">
            <h3 id="visual-notice-heading">{v.noticeTitle}</h3>
            <p>{v.notice}</p>
            {!state.visualNoticeAccepted && (
              <button
                type="button"
                onClick={() => {
                  controller.setVisualNoticeAccepted(true);
                  setNoticeStatus(v.accepted);
                  focusQuestion();
                  void saveVisualNotice(props.sessionKey).catch(() =>
                    setNoticeStatus(v.unavailableStorage),
                  );
                }}
              >
                {v.acknowledge}
              </button>
            )}
            <p role="status">{noticeStatus}</p>
          </section>
        )}
        {state.context && !allowed && (
          <p className="field-help">{s.draftOnly}</p>
        )}
        {state.snapshot &&
          isStructuredSnapshot(state.snapshot) &&
          !state.stale && (
            <div className="field">
              <label htmlFor="structured-section">{s.section}</label>
              <select
                id="structured-section"
                aria-describedby="structured-section-help"
                value={state.sectionId ?? ''}
                disabled={busy || voiceBusy}
                onChange={(event) =>
                  controller.setSection(event.target.value || null)
                }
              >
                <option value="">{s.allSections}</option>
                {state.snapshot.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.heading}
                  </option>
                ))}
              </select>
              <p id="structured-section-help" className="field-help">
                {s.sectionHelp}
              </p>
            </div>
          )}
        <VoiceTest
          sessionKey={props.sessionKey}
          transport={props.voiceTransport}
          uiLanguage={props.language}
          preferencesKey="voice:extension-preferences"
          mode="question"
          questionActions={
            <>
              <button
                type="button"
                className="primary"
                aria-describedby={
                  askUnavailable ? 'ask-availability' : undefined
                }
                disabled={
                  busy ||
                  voiceBusy ||
                  !allowed ||
                  !state.question.trim() ||
                  unicodeLength(state.question) > GROUNDED_QUESTION_MAX_LENGTH
                }
                onClick={() => {
                  props.onActivity?.();
                  setReturnStatus('');
                  setHeldVoiceQuestion(null);
                  void controller.ask();
                }}
              >
                {t.ask}
              </button>
              {busy && (
                <button
                  type="button"
                  onClick={() => {
                    controller.cancel();
                    focusQuestion();
                  }}
                >
                  {t.cancel}
                </button>
              )}
            </>
          }
          onController={attachVoice}
          disabled={busy}
          {...(props.settingsTarget !== undefined
            ? { preferencesTarget: props.settingsTarget }
            : {})}
        />
        {askUnavailable && (
          <p id="ask-availability" className="field-help">
            {askUnavailable}
          </p>
        )}
        <div className="controls composer-actions">
          <button
            type="button"
            disabled={busy || voiceBusy}
            onClick={() => {
              questionVoice.current?.editText(
                visualCandidate ? v.sample : t.sampleText,
              );
              focusQuestion();
            }}
          >
            {t.sample}
          </button>
        </div>
      </section>
      <p role="status" aria-atomic="true" className="status">
        {status}
      </p>
      {state.errorRequestId && (
        <details className="field-help">
          <summary>{v.requestDetails}</summary>
          <p>
            {v.requestReference}: {state.errorRequestId}
          </p>
        </details>
      )}
      {heldVoiceQuestion && (
        <div>
          <p role="status" aria-atomic="true">
            {t.voiceHeld}
          </p>
          <p>
            {heldVoiceQuestion === 'page'
              ? t.voiceHeldPage
              : heldVoiceQuestion === 'length'
                ? t.voiceHeldLength
                : t.voiceHeldBusy}
          </p>
        </div>
      )}
      {state.errorUsage && (
        <UsageLimitNotice
          usage={state.errorUsage}
          language={props.language}
          operation="answer"
        />
      )}
      {state.scopeRecovery && (
        <div className="notice">
          <p>{v.narrowing}</p>
          <div className="controls">
            <button
              type="button"
              onClick={() => {
                props.onActivity?.();
                void controller.askNarrower('current_view');
              }}
            >
              {v.readCurrent}
            </button>
            {state.error !== 'VISUAL_UNSUPPORTED' && (
              <button
                type="button"
                onClick={() => {
                  props.onActivity?.();
                  void controller.askNarrower('first_portion');
                }}
              >
                {v.readFirst}
              </button>
            )}
          </div>
        </div>
      )}
      {state.snapshot && state.stale && <p className="notice">{t.previous}</p>}
      {state.result && (
        <>
          <button
            type="button"
            className="quiet-action"
            onClick={() => answerHeading.current?.focus()}
          >
            {t.goAnswer}
          </button>
          <section aria-labelledby="answer-heading" className="answer-section">
            <h2 id="answer-heading" ref={answerHeading} tabIndex={-1}>
              {t.answer}
            </h2>
            <p className="answer-text" lang={resultLanguage}>
              {state.result.text}
            </p>
            {'source_kind' in state.result &&
              state.result.source_kind === 'structured_page' &&
              state.snapshot &&
              isStructuredSnapshot(state.snapshot) && (
                <p className="field-help">
                  {props.language === 'vi'
                    ? 'Nguồn trả lời: '
                    : 'Answer source: '}
                  {state.snapshot.title}. {s.included}:{' '}
                  {state.snapshot.sections
                    .filter(
                      (section) =>
                        state.result &&
                        'included_section_ids' in state.result &&
                        state.result.included_section_ids.includes(section.id),
                    )
                    .map((section) => section.heading)
                    .join('; ')}
                  .{state.result.partial && ` ${s.partial}`}
                </p>
              )}
            <div className="controls">
              <button
                type="button"
                disabled={
                  !playbackActive &&
                  (!allowed ||
                    !audio.speechEnabled ||
                    busy ||
                    voiceBusy ||
                    state.stale)
                }
                onClick={() => {
                  controller.discardAutomaticSpeech();
                  // A deliberate retry/read is a new speech action, not the
                  // original submitted task's automatic preparation deadline.
                  speechDeadline.current = null;
                  if (playbackActive) speech.stopPlayback();
                  else if (!allowed) return;
                  else {
                    props.onActivity?.();
                    if (audio.hasAudio) void speech.play();
                    else {
                      speech.setLanguage(resultLanguage);
                      speech.editText(resultText);
                      void speech.readBack();
                    }
                  }
                }}
              >
                {playbackActive
                  ? t.stop
                  : audio.notice === 'autoplay_blocked'
                    ? t.playAnswer
                    : audio.hasAudio
                      ? t.readAgain
                      : audio.errorCode
                        ? t.retrySpeech
                        : t.read}
              </button>
              <button
                type="button"
                disabled={busy || voiceBusy}
                onClick={() => {
                  controller.discardAutomaticSpeech();
                  speech.stopPlayback();
                  focusQuestion();
                }}
              >
                {t.askAnother}
              </button>
            </div>
            {!audio.speechEnabled && (
              <p className="field-help">{t.speechOff}</p>
            )}
            <p role="status" aria-atomic="true">
              {audio.errorCode
                ? `${t.answerSpeechFailed} ${voiceErrorText(props.language, audio.errorCode)}`
                : audio.notice === 'autoplay_blocked'
                  ? t.playbackBlocked
                  : audio.phase === 'generating'
                    ? t.speechPending
                    : audio.phase === 'speaking'
                      ? t.speechPlaying
                      : audio.notice === 'stopped' ||
                          audio.notice === 'cancelled'
                        ? t.speechStopped
                        : ''}
            </p>
            {audio.errorUsage && (
              <UsageLimitNotice
                usage={audio.errorUsage}
                language={props.language}
                operation="speak"
              />
            )}
            {state.result.status === 'answer' &&
              'evidence' in state.result &&
              !('source_kind' in state.result) && (
                <>
                  <p className="field-help">{t.capturedOnly}</p>
                  <details
                    ref={evidenceDetails}
                    className="evidence-disclosure"
                  >
                    <summary>{t.viewEvidence}</summary>
                    <h3 id="evidence-heading">{t.evidence}</h3>
                    <p>
                      {t.region}: {state.result.evidence.region}. {t.year}:{' '}
                      {state.result.evidence.year}. {t.unit}.
                    </p>
                    <SourceTable
                      rows={state.result.evidence.rows}
                      caption={state.result.evidence.table_title}
                      language={props.language}
                      sourceLanguage={
                        state.snapshot &&
                        !isStructuredSnapshot(state.snapshot) &&
                        !isVisualSnapshot(state.snapshot)
                          ? state.snapshot.locale
                          : 'en-US'
                      }
                    />
                    <p lang={resultLanguage}>
                      {state.result.evidence.calculation.description}
                    </p>
                    {state.result.evidence.calculation.limitation && (
                      <p lang={resultLanguage}>
                        {state.result.evidence.calculation.limitation}
                      </p>
                    )}
                    <p>
                      {state.result.evidence.origin}
                      {state.result.evidence.pathname}
                    </p>
                    <p>
                      {t.captured}:{' '}
                      <time dateTime={state.result.evidence.captured_at}>
                        {new Date(
                          state.result.evidence.captured_at,
                        ).toLocaleString(props.language)}
                      </time>
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        if (evidenceDetails.current) {
                          evidenceDetails.current.open = false;
                          evidenceDetails.current
                            .querySelector('summary')
                            ?.focus();
                        }
                      }}
                    >
                      {t.closeEvidence}
                    </button>
                  </details>
                </>
              )}
            {'source_kind' in state.result &&
              state.result.source_kind === 'visual_page' &&
              state.snapshot &&
              isVisualSnapshot(state.snapshot) && (
                <VisualSource
                  snapshot={state.snapshot}
                  response={state.result}
                  language={props.language}
                />
              )}
            {'evidence_ids' in state.result &&
              state.result.evidence_ids.length > 0 &&
              state.snapshot &&
              isStructuredSnapshot(state.snapshot) && (
                <details className="evidence-disclosure">
                  <summary>{s.evidence}</summary>
                  <StructuredSource
                    snapshot={state.snapshot}
                    language={props.language}
                    evidenceIds={state.result.evidence_ids}
                  />
                </details>
              )}
          </section>
        </>
      )}
      <details className="source-disclosure">
        <summary>{t.inspect}</summary>
        <p>{t.empty}</p>
        <button
          type="button"
          disabled={
            !state.context?.supported ||
            state.context.permission === 'required' ||
            busy ||
            voiceBusy
          }
          onClick={() => {
            props.onActivity?.();
            void controller.inspect();
          }}
        >
          {state.snapshot ? t.refresh : t.capture}
        </button>
        {state.snapshot && isStructuredSnapshot(state.snapshot) && (
          <StructuredSource
            snapshot={state.snapshot}
            language={props.language}
          />
        )}
        {state.snapshot &&
          !isStructuredSnapshot(state.snapshot) &&
          !isVisualSnapshot(state.snapshot) && (
            <section aria-labelledby="source-table-heading">
              <h3 id="source-table-heading">{t.table}</h3>
              {state.stale && <p className="notice">{t.previous}</p>}
              <p>
                {t.region}: {state.snapshot.region}. {t.year}:{' '}
                {state.snapshot.year}. {t.unit}.
              </p>
              <SourceTable
                rows={state.snapshot.rows}
                caption={state.snapshot.table_title}
                language={props.language}
                sourceLanguage={state.snapshot.locale}
              />
              <p>
                {t.captured}:{' '}
                <time dateTime={state.snapshot.captured_at}>
                  {new Date(state.snapshot.captured_at).toLocaleString(
                    props.language,
                  )}
                </time>
              </p>
            </section>
          )}
      </details>
      {props.settingsTarget === undefined
        ? speechPreferences
        : props.settingsTarget
          ? createPortal(speechPreferences, props.settingsTarget)
          : null}
      <div className="return-controls">
        <button
          type="button"
          disabled={!state.context?.origin}
          onClick={() => {
            void controller
              .returnToPage()
              .then((result) =>
                setReturnStatus(result.restored ? t.returned : t.fallback),
              )
              .catch(() => setReturnStatus(t.returnFailed));
          }}
        >
          {t.return}
        </button>
        <p role="status" aria-atomic="true">
          {returnStatus}
        </p>
      </div>
    </div>
  );
}

function SourceTable({
  rows,
  caption,
  language,
  sourceLanguage,
}: {
  rows: GroundedRow[];
  caption: string;
  language: UiLanguage;
  sourceLanguage: 'en-US' | 'vi-VN';
}) {
  const t = groundedText[language];
  return (
    <div
      className="table-scroll"
      role="region"
      aria-label={t.table}
      tabIndex={0}
    >
      <table>
        <caption lang={sourceLanguage}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t.month}</th>
            <th scope="col">{t.value}</th>
            <th scope="col">{t.row}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">
                <time dateTime={row.period}>{row.period}</time>
              </th>
              <td>{row.raw_value}</td>
              <td>{row.id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
