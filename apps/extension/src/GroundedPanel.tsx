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
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
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
  const [section, setSection] = useState<'answer' | 'evidence' | 'table'>(
    'answer',
  );
  const [returnStatus, setReturnStatus] = useState('');
  const answerHeading = useRef<HTMLHeadingElement>(null);
  const evidenceHeading = useRef<HTMLHeadingElement>(null);
  const tableHeading = useRef<HTMLHeadingElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const resultText = state.result?.status === 'answer' ? state.result.text : '';
  const resultLanguage = state.resultLanguage ?? props.language;
  const allowed =
    state.context?.supported && state.context.origin === state.consentOrigin;
  const busy = state.phase === 'reading' || state.phase === 'understanding';
  const focusSection = useRef(false);

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
  useEffect(() => {
    if (!focusSection.current) return;
    focusSection.current = false;
    (section === 'answer'
      ? answerHeading
      : section === 'evidence'
        ? evidenceHeading
        : tableHeading
    ).current?.focus();
  }, [section]);
  const navigate = (next: typeof section) => {
    if (next === section) {
      (next === 'answer'
        ? answerHeading
        : next === 'evidence'
          ? evidenceHeading
          : tableHeading
      ).current?.focus();
    } else {
      focusSection.current = true;
      setSection(next);
    }
  };
  const status = state.error
    ? groundedError(props.language, state.error)
    : state.phase === 'stale'
      ? t.previous
      : t[state.phase === 'error' ? 'idle' : state.phase];

  return (
    <div className="grounded-panel" ref={surface} lang={props.language}>
      <section aria-labelledby="page-context-heading">
        <h2 id="page-context-heading">{t.page}</h2>
        <p role="status" aria-atomic="true">
          {state.context === null
            ? t.checking
            : state.context.supported
              ? t.supported
              : t.unsupported}
        </p>
        {state.context?.supported && <p>{state.context.origin}/orders</p>}
        <p>{t.scope}</p>
      </section>
      <section
        className="notice"
        aria-labelledby="processing-permission-heading"
      >
        <h2 id="processing-permission-heading">{t.permission}</h2>
        {!state.context?.supported && (
          <div id="page-permission-help">
            <p>{t.permissionHelp}</p>
            <ul>
              {supportedOrigins.map((origin) => (
                <li key={origin}>
                  <a href={`${origin}/orders`} target="_blank" rel="noreferrer">
                    {origin}/orders
                  </a>
                </li>
              ))}
            </ul>
            <p>{t.recheckHelp}</p>
          </div>
        )}
        {allowed ? (
          <p>{t.allowed}</p>
        ) : (
          <>
            <p>{t.notice}</p>
            <a
              href="https://www.avis.net/docs/2.%20Avis%20-%20Ch%C3%ADnh%20s%C3%A1ch%20b%E1%BA%A3o%20m%E1%BA%ADt.pdf"
              target="_blank"
              rel="noreferrer"
            >
              {t.privacy}
            </a>
          </>
        )}
        <div className="controls">
          {!allowed && (
            <button
              type="button"
              disabled={!state.context?.supported}
              aria-describedby={
                !state.context?.supported ? 'page-permission-help' : undefined
              }
              onClick={() => {
                void controller.allow();
              }}
            >
              {t.allow}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void controller.refreshContext();
            }}
          >
            {t.recheck}
          </button>
          <button
            type="button"
            onClick={() => {
              controller.revoke();
              setSection('answer');
            }}
          >
            {t.deny}
          </button>
        </div>
      </section>
      <VoiceTest
        sessionKey={props.sessionKey}
        transport={props.voiceTransport}
        uiLanguage={props.language}
        preferencesKey="voice:extension-preferences"
        mode="question"
        onController={attachVoice}
        disabled={busy}
      />
      <div className="controls">
        <button
          type="button"
          disabled={busy || voiceBusy}
          onClick={() => {
            questionVoice.current?.editText(t.sampleText);
            surface.current
              ?.querySelector<HTMLTextAreaElement>('textarea')
              ?.focus();
          }}
        >
          {t.sample}
        </button>
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
            setSection('answer');
            setReturnStatus('');
            void controller.ask(props.language);
          }}
        >
          {t.ask}
        </button>
        {busy && (
          <button type="button" onClick={controller.cancel}>
            {t.cancel}
          </button>
        )}
      </div>
      <p role="status" aria-atomic="true" className="status">
        {status}
      </p>
      {state.snapshot && state.stale && <p className="notice">{t.previous}</p>}
      <div className="controls">
        {state.snapshot && (
          <button type="button" onClick={() => navigate('table')}>
            {t.viewTable}
          </button>
        )}
        <button
          type="button"
          disabled={!allowed || busy || voiceBusy}
          onClick={() => {
            navigate('table');
            void controller.inspect();
          }}
        >
          {state.snapshot ? t.refresh : t.capture}
        </button>
      </div>
      {section === 'answer' && (
        <section aria-labelledby="answer-heading">
          <h2 id="answer-heading" ref={answerHeading} tabIndex={-1}>
            {t.answer}
          </h2>
          <p lang={state.result ? resultLanguage : props.language}>
            {state.result?.text ?? t.empty}
          </p>
          {state.snapshot && (
            <p>
              {t.captured}:{' '}
              <time dateTime={state.snapshot.captured_at}>
                {new Date(state.snapshot.captured_at).toLocaleString(
                  props.language,
                )}
              </time>
            </p>
          )}
          {state.result?.status === 'answer' && (
            <>
              <p>{t.capturedOnly}</p>
              <button type="button" onClick={() => navigate('evidence')}>
                {t.viewEvidence}
              </button>
            </>
          )}
        </section>
      )}
      {section === 'evidence' && state.result?.status === 'answer' && (
        <section aria-labelledby="evidence-heading">
          <h2 id="evidence-heading" ref={evidenceHeading} tabIndex={-1}>
            {t.evidence}
          </h2>
          <p lang={resultLanguage}>{state.result.text}</p>
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
              {new Date(state.result.evidence.captured_at).toLocaleString(
                props.language,
              )}
            </time>
          </p>
          <button type="button" onClick={() => navigate('answer')}>
            {t.back}
          </button>
        </section>
      )}
      {section === 'table' && (
        <section aria-labelledby="source-table-heading">
          <h2 id="source-table-heading" ref={tableHeading} tabIndex={-1}>
            {t.table}
          </h2>
          {state.snapshot && (
            <>
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
            </>
          )}
          <button type="button" onClick={() => navigate('answer')}>
            {t.back}
          </button>
        </section>
      )}
      {state.result?.status === 'answer' && (
        <fieldset>
          <legend>{t.read}</legend>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={audio.speechEnabled}
              onChange={(event) =>
                speech.setSpeechEnabled(event.target.checked)
              }
            />
            {t.speech}
          </label>
          <p>{t.speechHelp}</p>
          <div className="controls">
            <button
              type="button"
              disabled={
                !audio.speechEnabled ||
                busy ||
                voiceBusy ||
                audio.phase === 'generating' ||
                state.stale
              }
              onClick={() => {
                speech.editText(resultText);
                void speech.readBack();
              }}
            >
              {t.read}
            </button>
            <button
              type="button"
              disabled={
                !audio.speechEnabled ||
                !audio.hasAudio ||
                voiceBusy ||
                audio.phase === 'generating' ||
                state.stale
              }
              onClick={() => {
                void speech.play();
              }}
            >
              {t.repeat}
            </button>
            <button
              type="button"
              disabled={!['generating', 'speaking'].includes(audio.phase)}
              onClick={() => speech.cancel()}
            >
              {t.stop}
            </button>
          </div>
          <label htmlFor="answer-speed">{t.speed}</label>
          <select
            id="answer-speed"
            value={audio.playbackRate}
            onChange={(event) =>
              speech.setPlaybackRate(Number(event.target.value))
            }
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
              <option key={rate} value={rate}>
                {rate}×
              </option>
            ))}
          </select>
          <p role="status" aria-atomic="true">
            {audio.errorCode
              ? voiceErrorText(props.language, audio.errorCode)
              : audio.phase === 'generating'
                ? t.speechPending
                : ''}
          </p>
        </fieldset>
      )}
      <section>
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
      </section>
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
