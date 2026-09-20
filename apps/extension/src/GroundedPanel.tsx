import {
  GROUNDED_QUESTION_MAX_LENGTH,
  unicodeLength,
  type GroundedRow,
  type UiLanguage,
} from '@adc/contracts';
import {
  VoiceController,
  VoiceTest,
  browserDependencies,
  voiceErrorText,
  type VoiceTransport,
} from '@adc/voice-ui';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { OrdersPageContext } from './page-context.ts';
import { ordersOrigins } from './config-values.ts';
import { GroundedController } from './grounded-controller.ts';
import { createGroundedTransport } from './grounded-transport.ts';
import { groundedError, groundedText } from './grounded-strings.ts';

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
}
interface Mounted {
  controller: GroundedController;
  speech: VoiceController;
}

export function GroundedPanel(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const questionVoice = useRef<VoiceController | null>(null);
  const [mounted, setMounted] = useState<Mounted | null>(null);
  useEffect(() => {
    const speech = new VoiceController(
      {
        speak: (...args) => latest.current.voiceTransport.speak(...args),
        transcribe: (...args) =>
          latest.current.voiceTransport.transcribe(...args),
      },
      browserDependencies,
    );
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem('vsual:answer-preferences') ??
          localStorage.getItem('voice:extension-preferences') ??
          '{}',
      );
      if (saved && typeof saved === 'object') {
        if (
          'speechEnabled' in saved &&
          typeof saved.speechEnabled === 'boolean'
        )
          speech.setSpeechEnabled(saved.speechEnabled);
        if ('playbackRate' in saved && typeof saved.playbackRate === 'number')
          speech.setPlaybackRate(saved.playbackRate);
      }
    } catch {
      /* Preference storage is optional. */
    }
    const controller = new GroundedController(
      new OrdersPageContext(supportedOrigins),
      createGroundedTransport({
        baseUrl: latest.current.backend,
        getHeaders: () => latest.current.getHeaders(),
        onUnauthenticated: () => latest.current.onExpired(),
      }),
      () => {
        speech.cancel();
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
    );
    setMounted({ controller, speech });
    void controller.refreshContext();
    const end = () => {
      controller.revoke();
      questionVoice.current?.clear();
      speech.clear();
    };
    const visibility = () => {
      if (document.hidden) end();
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
  questionVoice,
  ...props
}: Props &
  Mounted & {
    questionVoice: React.RefObject<VoiceController | null>;
  }) {
  const t = groundedText[props.language];
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const audio = useSyncExternalStore(
    speech.subscribe,
    speech.getSnapshot,
    speech.getSnapshot,
  );
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [returnStatus, setReturnStatus] = useState('');
  const answerHeading = useRef<HTMLHeadingElement>(null);
  const evidenceDetails = useRef<HTMLDetailsElement>(null);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const initialFocus = useRef(false);
  const permissionFocus = useRef(false);
  const permissionDetails = useRef<HTMLDetailsElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const resultText = state.result?.status === 'answer' ? state.result.text : '';
  const resultLanguage = state.resultLanguage ?? props.language;
  const allowed =
    state.context?.supported && state.context.origin === state.consentOrigin;
  const busy = state.phase === 'reading' || state.phase === 'understanding';
  useLayoutEffect(() => {
    // Keep the disclosure mounted so a context change preserves summary focus.
    if (permissionDetails.current) permissionDetails.current.open = !allowed;
    if (!allowed || !permissionFocus.current) return;
    permissionFocus.current = false;
    if (
      (document.activeElement === document.body ||
        permissionDetails.current?.contains(document.activeElement)) &&
      !surface.current?.closest('[hidden]')
    )
      surface.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
  }, [allowed]);
  useEffect(() => {
    if (initialFocus.current || !state.context) return;
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
  }, [state.context, allowed]);

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
      const update = () => {
        const next = voice.getSnapshot();
        const capturing = [
          'requesting_permission',
          'recording',
          'transcribing',
        ].includes(next.phase);
        if (capturing) speech.cancel();
        setVoiceBusy(capturing);
        controller.setQuestion(next.text);
      };
      const unsubscribe = voice.subscribe(update);
      update();
      return () => {
        unsubscribe();
        if (questionVoice.current === voice) questionVoice.current = null;
        setVoiceReady(false);
      };
    },
    [controller, speech, questionVoice],
  );

  useEffect(() => {
    if (!voiceReady) return;
    return props.onReady(
      () => {
        if (controller.busy) controller.cancel();
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
    speech.setLanguage(resultLanguage);
    speech.editText(resultText);
  }, [speech, resultText, resultLanguage]);
  useEffect(() => {
    try {
      localStorage.setItem(
        'vsual:answer-preferences',
        JSON.stringify({
          speechEnabled: audio.speechEnabled,
          playbackRate: audio.playbackRate,
        }),
      );
    } catch {
      /* Optional non-sensitive preferences only. */
    }
  }, [audio.speechEnabled, audio.playbackRate]);
  const status = state.error
    ? groundedError(props.language, state.error)
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
          onChange={(event) => speech.setSpeechEnabled(event.target.checked)}
        />
        {t.speech}
      </label>
      <p>{t.speechHelp}</p>
      <label htmlFor="answer-speed">{t.speed}</label>
      <select
        id="answer-speed"
        value={audio.playbackRate}
        onChange={(event) => speech.setPlaybackRate(Number(event.target.value))}
      >
        {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
          <option key={rate} value={rate}>
            {rate}×
          </option>
        ))}
      </select>
      {props.settingsTarget && playbackActive && (
        <button
          type="button"
          onClick={() => {
            speech.cancel();
            document.getElementById('answer-speech-enabled')?.focus();
          }}
        >
          {t.stop}
        </button>
      )}
    </fieldset>
  );
  const permissionContent = (
    <>
      {allowed ? <p>{t.permissionSaved}</p> : <p>{t.permissionIntro}</p>}
      <details>
        <summary>{t.permissionDetail}</summary>
        <p>{t.notice}</p>
        <a
          href="https://www.avis.net/docs/2.%20Avis%20-%20Ch%C3%ADnh%20s%C3%A1ch%20b%E1%BA%A3o%20m%E1%BA%ADt.pdf"
          target="_blank"
          rel="noreferrer"
        >
          {t.privacy}
        </a>
      </details>
      {!allowed ? (
        <button
          type="button"
          disabled={!state.context?.supported}
          aria-describedby={
            !state.context?.supported ? 'page-permission-help' : undefined
          }
          onClick={(event) => {
            permissionFocus.current =
              document.activeElement === event.currentTarget;
            void controller.allow();
          }}
        >
          {t.allow}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            controller.revoke();
            pageHeading.current?.focus();
          }}
        >
          {t.deny}
        </button>
      )}
    </>
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
            {new URL(state.context.origin).host}/orders
          </p>
        )}
        <p role="status" aria-atomic="true">
          {state.error === 'PAGE_UNAVAILABLE'
            ? t.unavailablePage
            : state.context === null
              ? t.checking
              : state.context.reason === 'unavailable'
                ? t.unavailablePage
                : !state.context.supported
                  ? t.unsupported
                  : allowed
                    ? t.readyPage
                    : t.needConsent}
        </p>
        {!state.context?.supported && (
          <div id="page-permission-help">
            <p>{t.permissionHelp}</p>
            <ul>
              {supportedOrigins.map((origin) => (
                <li key={origin}>
                  <a href={`${origin}/orders`} target="_blank" rel="noreferrer">
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
          onClick={() => void controller.refreshContext()}
        >
          {t.recheck}
        </button>
      </section>
      <section
        aria-labelledby="processing-permission-heading"
        className="processing-consent"
      >
        <details ref={permissionDetails}>
          <summary id="processing-permission-heading">{t.permission}</summary>
          {permissionContent}
        </details>
      </section>
      <section
        aria-label={
          props.language === 'vi' ? 'Câu hỏi của bạn' : 'Your question'
        }
        className="question-composer"
      >
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
                disabled={
                  busy ||
                  voiceBusy ||
                  !allowed ||
                  !state.question.trim() ||
                  unicodeLength(state.question) > GROUNDED_QUESTION_MAX_LENGTH
                }
                onClick={() => {
                  setReturnStatus('');
                  void controller.ask(props.language);
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
        <div className="controls composer-actions">
          <button
            type="button"
            disabled={busy || voiceBusy}
            onClick={() => {
              questionVoice.current?.editText(t.sampleText);
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
            {state.result.status === 'answer' && (
              <>
                <p className="field-help">{t.capturedOnly}</p>
                <div className="controls">
                  <button
                    type="button"
                    disabled={
                      !playbackActive &&
                      (!audio.speechEnabled || busy || voiceBusy || state.stale)
                    }
                    onClick={() => {
                      if (playbackActive) speech.cancel();
                      else if (audio.hasAudio) void speech.play();
                      else {
                        speech.editText(resultText);
                        void speech.readBack();
                      }
                    }}
                  >
                    {playbackActive
                      ? t.stop
                      : audio.hasAudio
                        ? t.readAgain
                        : t.read}
                  </button>
                  <button
                    type="button"
                    disabled={busy || voiceBusy}
                    onClick={() => {
                      speech.cancel();
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
                    ? voiceErrorText(props.language, audio.errorCode)
                    : audio.phase === 'generating'
                      ? t.speechPending
                      : audio.phase === 'speaking'
                        ? t.speechPlaying
                        : audio.notice === 'stopped' ||
                            audio.notice === 'cancelled'
                          ? t.speechStopped
                          : ''}
                </p>
                <details ref={evidenceDetails} className="evidence-disclosure">
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
                    sourceLanguage={state.snapshot?.locale ?? 'en-US'}
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
            {state.result.status !== 'answer' && (
              <button type="button" onClick={focusQuestion}>
                {t.askAnother}
              </button>
            )}
          </section>
        </>
      )}
      <details className="source-disclosure">
        <summary>{t.inspect}</summary>
        <p>{t.empty}</p>
        <button
          type="button"
          disabled={!allowed || busy || voiceBusy}
          onClick={() => void controller.inspect()}
        >
          {state.snapshot ? t.refresh : t.capture}
        </button>
        {state.snapshot && (
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
          disabled={!state.context?.supported}
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
