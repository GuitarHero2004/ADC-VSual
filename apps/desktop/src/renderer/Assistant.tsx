import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { VISUAL_LIMITS, type UiLanguage } from '@adc/contracts';
import { SignInForm } from '../../../../packages/voice-ui/src/SignInForm.tsx';
import { browserDependencies } from '../../../../packages/voice-ui/src/browser.ts';
import { UsageLimitNotice } from '../../../../packages/voice-ui/src/UsageLimitNotice.tsx';
import {
  errorText as voiceErrorText,
  questionNoticeText,
} from '../../../../packages/voice-ui/src/strings.ts';
import type { DesktopBridge, DesktopShortcut } from '../bridge.ts';
import type { DesktopSessionState } from '../session-types.ts';
import { captureWindowFrame } from '../capture-frame.ts';
import {
  DesktopAssistantController,
  safeErrorCode,
  type AssistantDependencies,
} from './assistant-controller.ts';
import {
  assistantText,
  desktopError,
  screenError,
} from './assistant-strings.ts';

interface Props {
  bridge: DesktopBridge;
  language: UiLanguage;
  shortcut: DesktopShortcut;
  dependencies?: AssistantDependencies;
  onBeforeWork?: () => void;
  registerStopWork?: (stop: (() => void) | null) => void;
  onSessionChange?: (session: DesktopSessionState | null) => void;
}

export function DesktopAssistant({
  bridge,
  language,
  shortcut,
  dependencies,
  onBeforeWork,
  registerStopWork,
  onSessionChange,
}: Props) {
  const [session, setSession] = useState<DesktopSessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [retry, setRetry] = useState(0);
  const revision = useRef(0);
  const live = useRef(false);
  const text = assistantText[language];
  const accepted = useRef<DesktopSessionState | null>(null);
  const activeController = useRef<DesktopAssistantController | null>(null);
  const beforeWork = useRef(onBeforeWork);
  beforeWork.current = onBeforeWork;
  const sessionChanged = useRef(onSessionChange);
  sessionChanged.current = onSessionChange;
  const registerStop = useRef(registerStopWork);
  registerStop.current = registerStopWork;
  const [controllerReady, setControllerReady] = useState(false);
  const [activationNotice, setActivationNotice] = useState(false);
  const focusGeneration = useRef(0);
  const stopGuide = useCallback(() => beforeWork.current?.(), []);
  const acceptController = useCallback(
    (controller: DesktopAssistantController | null, ready = true) => {
      activeController.current = controller;
      registerStop.current?.(controller?.cancel ?? null);
      setControllerReady(controller !== null && ready);
    },
    [],
  );

  useEffect(() => {
    let active = true;
    const removeActivation = bridge.onActivate((event) => {
      const generation = ++focusGeneration.current;
      if (event.kind === 'talk') stopGuide();
      const currentSession = accepted.current;
      const controller = activeController.current;
      if (
        !controller ||
        currentSession?.phase !== 'signed_in' ||
        currentSession.workspace !== 'allowed'
      ) {
        // Consume the intent now; successful login never arms an old microphone request.
        if (event.kind === 'talk') {
          setActivationNotice(true);
          document.getElementById('desktop-signin-title')?.focus();
        }
        return;
      }
      setActivationNotice(false);
      // Do not move focus when delayed native or permission work resolves.
      if (event.kind === 'talk')
        document.getElementById('desktop-question')?.focus();
      void controller.activate(event).catch(() => {
        if (
          active &&
          generation === focusGeneration.current &&
          activeController.current === controller
        )
          setError('unavailable');
      });
    });
    const removeSuspend = bridge.onSuspend(() => {
      focusGeneration.current++;
      activeController.current?.cancel();
    });
    return () => {
      active = false;
      focusGeneration.current++;
      removeActivation();
      removeSuspend();
    };
  }, [bridge, stopGuide]);

  useEffect(() => {
    live.current = true;
    let active = true;
    let eventReceived = false;
    const remove = bridge.onSession((next) => {
      if (!active) return;
      if (
        next.epoch !== accepted.current?.epoch ||
        next.phase !== 'signed_in' ||
        next.workspace !== 'allowed'
      ) {
        focusGeneration.current++;
        activeController.current?.cancel();
      }
      eventReceived = true;
      accepted.current = next;
      sessionChanged.current?.(next);
      setSession(next);
      setLoading(false);
      setError(null);
    });
    setLoading(true);
    void bridge.getSession().then(
      (next) => {
        if (!active || eventReceived) return;
        accepted.current = next;
        sessionChanged.current?.(next);
        setSession(next);
        setLoading(false);
      },
      () => {
        if (!active || eventReceived) return;
        setLoading(false);
        setError('unavailable');
      },
    );
    return () => {
      active = false;
      live.current = false;
      revision.current++;
      sessionChanged.current?.(null);
      remove();
    };
  }, [bridge, retry]);

  async function auth(operation: () => Promise<DesktopSessionState>) {
    stopGuide();
    const current = ++revision.current;
    const before = accepted.current;
    setError(null);
    try {
      const next = await operation();
      if (!live.current || revision.current !== current) return;
      // An emitted account transition is authoritative over an older IPC reply.
      if (accepted.current !== before && accepted.current?.epoch !== next.epoch)
        return;
      accepted.current = next;
      sessionChanged.current?.(next);
      setSession(next);
    } catch (failure) {
      if (live.current && revision.current === current)
        setError(safeErrorCode(failure));
    }
  }

  async function signOut() {
    stopGuide();
    accepted.current = null;
    sessionChanged.current?.(null);
    focusGeneration.current++;
    activeController.current?.cancel();
    setSigningOut(true);
    // Remove the session-owned controls immediately, before remote logout finishes.
    setSession(null);
    await auth(() => bridge.signOut());
    if (live.current) setSigningOut(false);
  }

  const allowed =
    !signingOut &&
    session?.phase === 'signed_in' &&
    session.workspace === 'allowed' &&
    session.account;
  const errorCode = error ?? session?.errorCode?.toLowerCase();
  useEffect(() => {
    if (loading || (allowed && !controllerReady)) return;
    void bridge.activationReady().catch(() => {
      if (live.current) setError('unavailable');
    });
  }, [bridge, loading, allowed, controllerReady]);
  return (
    <section
      id="desktop-assistant"
      tabIndex={-1}
      className="desktop-assistant"
      aria-label={text.title}
    >
      <p className="desktop-help">{text.separate}</p>
      {activationNotice && <p role="status">{text.activationRequiresAccess}</p>}
      {loading || signingOut ? (
        <p role="status">{signingOut ? text.signingOut : text.checking}</p>
      ) : session?.account ? (
        <div className="desktop-account">
          <p>
            {text.account}: <span>{session.account.email}</span>
          </p>
          <button type="button" onClick={() => void signOut()}>
            {text.signOut}
          </button>
          {!allowed && (
            <p>
              {session.workspace === 'denied' ? text.denied : text.unavailable}
            </p>
          )}
          {!allowed && (
            <button
              type="button"
              onClick={() => void auth(() => bridge.retrySession())}
            >
              {text.retrySession}
            </button>
          )}
        </div>
      ) : (
        <section aria-labelledby="desktop-signin-title">
          <h2 id="desktop-signin-title" tabIndex={-1}>
            {text.signIn}
          </h2>
          <SignInForm
            language={language}
            busy={session?.phase === 'signing_in'}
            onSubmit={(email, password) =>
              auth(() => bridge.signIn(email, password))
            }
            error={errorCode ? desktopError(errorCode, language) : null}
          />
          {session?.phase === 'signing_in' && (
            <button type="button" onClick={() => void signOut()}>
              {text.cancel}
            </button>
          )}
          {session?.logoutConfirmed === false && <p>{text.logoutOffline}</p>}
          {(!session || session.phase === 'unavailable') && (
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              {text.retrySession}
            </button>
          )}
        </section>
      )}
      {session?.account && errorCode && (
        <p role="alert">{desktopError(errorCode, language)}</p>
      )}
      {allowed && (
        <SessionAssistant
          key={`${allowed.id}:${session.epoch}`}
          bridge={bridge}
          epoch={session.epoch}
          language={language}
          shortcut={shortcut}
          onBeforeWork={stopGuide}
          onController={acceptController}
          {...(dependencies ? { dependencies } : {})}
        />
      )}
    </section>
  );
}

function SessionAssistant({
  bridge,
  epoch,
  language,
  shortcut,
  dependencies,
  onBeforeWork,
  onController,
}: Props & {
  epoch: string;
  onController: (
    controller: DesktopAssistantController | null,
    ready?: boolean,
  ) => void;
}) {
  const [controller, setController] =
    useState<DesktopAssistantController | null>(null);
  useEffect(() => {
    let live = true;
    const current = new DesktopAssistantController(
      bridge,
      epoch,
      dependencies ?? {
        capture: captureWindowFrame,
        voice: browserDependencies,
      },
      onBeforeWork,
    );
    setController(current);
    onController(current, false);
    // Source metadata is safe to restore after login; this never starts recording.
    void current.useActiveSource().then(() => {
      if (live) onController(current, true);
    });
    return () => {
      live = false;
      onController(null);
      current.dispose();
    };
  }, [bridge, epoch, dependencies, onBeforeWork, onController]);
  return controller ? (
    <AssistantControls
      controller={controller}
      language={language}
      shortcut={shortcut}
      {...(onBeforeWork ? { onBeforeWork } : {})}
    />
  ) : (
    <p role="status">{assistantText[language].checking}</p>
  );
}

export function AssistantControls({
  controller,
  language,
  shortcut,
  onBeforeWork,
}: {
  controller: DesktopAssistantController;
  language: UiLanguage;
  shortcut: DesktopShortcut;
  onBeforeWork?: () => void;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const question = useSyncExternalStore(
    controller.question.subscribe,
    controller.question.getSnapshot,
    controller.question.getSnapshot,
  );
  const speech = useSyncExternalStore(
    controller.speech.subscribe,
    controller.speech.getSnapshot,
    controller.speech.getSnapshot,
  );
  const text = assistantText[language];
  const busy = ['preparing', 'capturing', 'asking'].includes(state.phase);
  const recording = [
    'requesting_permission',
    'recording',
    'transcribing',
  ].includes(question.phase);
  const tooLong =
    Array.from(question.text).length > VISUAL_LIMITS.questionCodePoints;
  const answer = state.answer;
  const speechStatus =
    speech.notice === 'autoplay_blocked'
      ? text.audioBlocked
      : speech.phase === 'generating'
        ? text.audioGenerating
        : speech.phase === 'speaking'
          ? text.audioPlaying
          : speech.notice === 'stopped'
            ? text.audioStopped
            : speech.hasAudio
              ? text.audioReady
              : '';
  const status = state.errorCode
    ? screenError(state.errorCode, language)
    : state.phase === 'error'
      ? ''
      : text[state.phase];

  return (
    <div className="desktop-reader">
      <h2>{text.title}</h2>
      <p>{text.introduction}</p>
      <p className="notice">{text.privacy}</p>
      <p className="desktop-help">{text.scope}</p>
      <p className="desktop-current-source">
        <strong>{text.sources}: </strong>
        {state.sources.find((source) => source.id === state.sourceId)?.title ??
          text.noActiveSource}
      </p>
      <p role="status">
        {state.loadingSources
          ? text.refreshing
          : state.sourceId
            ? text.sourceReady
            : ''}
      </p>
      <p className="desktop-help">
        {text.activeHelp.replace(
          '{shortcut}',
          shortcut.replace('Control', 'Ctrl').replaceAll('+', ' + '),
        )}
      </p>

      <label htmlFor="desktop-question">{text.question}</label>
      <textarea
        id="desktop-question"
        value={question.text}
        readOnly={recording || busy}
        aria-describedby="desktop-question-help"
        aria-invalid={tooLong}
        onChange={(event) => controller.editQuestion(event.currentTarget.value)}
      />
      <p id="desktop-question-help" className="desktop-help">
        {tooLong ? text.questionTooLong : text.questionHelp}
      </p>
      <div className="controls">
        <button
          type="button"
          className="primary"
          disabled={
            busy ||
            recording ||
            !state.sourceId ||
            !question.text.trim() ||
            tooLong
          }
          onClick={() => void controller.ask()}
        >
          {text.ask}
        </button>
        {question.phase === 'recording' ? (
          <button type="button" onClick={() => controller.question.finish()}>
            {text.stopRecord}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || recording || !state.sourceId}
            onClick={() => void controller.startRecording()}
          >
            {text.record}
          </button>
        )}
        {(busy || recording) && (
          <button type="button" onClick={controller.cancel}>
            {text.cancel}
          </button>
        )}
        {!busy && !recording && question.text && (
          <button type="button" onClick={() => controller.editQuestion('')}>
            {text.clear}
          </button>
        )}
      </div>
      <p className="desktop-help">{text.recordHelp}</p>
      <p role="status" aria-atomic="true">
        {question.errorCode
          ? voiceErrorText(
              language,
              question.errorCode,
              question.errorOperation,
            )
          : recording ||
              question.notice === 'no_speech' ||
              question.notice === 'silence_unavailable'
            ? question.notice === 'duration_reached'
              ? text.recordingLimit
              : questionNoticeText(language, question.notice)
            : ''}
      </p>
      {question.silenceSecondsRemaining !== null && (
        <p className="desktop-countdown" aria-live="off">
          {text.countdown.replace(
            '{seconds}',
            String(question.silenceSecondsRemaining),
          )}
        </p>
      )}
      {question.errorUsage && (
        <UsageLimitNotice
          usage={question.errorUsage}
          language={language}
          operation="transcribe"
        />
      )}
      <p className="desktop-reader-status" role="status" aria-atomic="true">
        {status}
      </p>
      {state.errorDetails && (
        <details className="desktop-request-details">
          <summary>{text.requestDetails}</summary>
          <p>
            {text.failureStage}: {text[state.errorDetails.stage]}
          </p>
          <p>
            {text.errorCode}: <code>{state.errorCode}</code>
          </p>
          <p>
            {text.reference}: <code>{state.errorDetails.requestId}</code>
          </p>
          {state.errorDetails.stage !== 'asking' && (
            <p>{text.beforeImageSent}</p>
          )}
        </details>
      )}
      {state.errorUsage && (
        <UsageLimitNotice
          usage={state.errorUsage}
          language={language}
          operation="answer"
        />
      )}

      {answer && (
        <section
          className="desktop-answer"
          aria-labelledby="desktop-answer-title"
        >
          <h2 id="desktop-answer-title">{text[answer.response.status]}</h2>
          <p className="answer-text" lang={answer.response.answer_language}>
            {answer.response.text}
          </p>
          <p>{answer.title}</p>
          <p>
            {text.captured}:{' '}
            <time dateTime={answer.response.captured_at}>
              {new Date(answer.response.captured_at).toLocaleString(
                language === 'vi' ? 'vi-VN' : 'en',
              )}
            </time>
          </p>
          <div className="controls">
            <button
              type="button"
              disabled={
                recording ||
                speech.phase === 'generating' ||
                speech.phase === 'speaking'
              }
              onClick={() => {
                onBeforeWork?.();
                void controller.speech.readBack();
              }}
            >
              {speech.hasAudio
                ? speech.notice === 'autoplay_blocked'
                  ? text.playAnswer
                  : text.repeat
                : speech.errorCode
                  ? text.retrySpeech
                  : text.readAnswer}
            </button>
            <button
              type="button"
              aria-disabled={
                speech.phase !== 'generating' && speech.phase !== 'speaking'
              }
              onClick={() => {
                if (
                  speech.phase === 'generating' ||
                  speech.phase === 'speaking'
                )
                  controller.speech.stopPlayback();
              }}
            >
              {text.stopSpeech}
            </button>
          </div>
          <p role="status" aria-atomic="true">
            {speech.errorCode
              ? voiceErrorText(
                  language,
                  speech.errorCode,
                  speech.errorOperation,
                )
              : speechStatus}
          </p>
          {speech.errorUsage && (
            <UsageLimitNotice
              usage={speech.errorUsage}
              language={language}
              operation="speak"
            />
          )}
          <details className="desktop-evidence">
            <summary>{text.evidence}</summary>
            <p>{text.evidenceHelp}</p>
            {answer.response.evidence.length ? (
              <ul>
                {answer.response.evidence.map((item, index) => (
                  <li key={index}>
                    <p lang={answer.response.answer_language}>
                      {item.description}
                    </p>
                    <p>
                      {text.image} 1. {text.region}:{' '}
                      {[
                        item.region.x,
                        item.region.y,
                        item.region.width,
                        item.region.height,
                      ]
                        .map((value) => `${Math.round(value * 100)}%`)
                        .join(', ')}
                      .
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{text.noEvidence}</p>
            )}
            <p>
              {text.reference}: <code>{answer.response.request_id}</code>
            </p>
          </details>
        </section>
      )}

      <details className="desktop-voice-settings">
        <summary>
          {language === 'vi'
            ? 'Giọng nói và quyền riêng tư'
            : 'Voice and privacy'}
        </summary>
        <p className="desktop-help">{text.speechHelp}</p>
        <label htmlFor="desktop-recording-language">
          {text.recordingLanguage}
        </label>
        <select
          id="desktop-recording-language"
          value={question.language}
          disabled={recording || busy}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value === 'auto' || value === 'en' || value === 'vi')
              controller.question.setLanguage(value);
          }}
        >
          <option value="auto">{text.auto}</option>
          <option value="en" lang="en">
            English
          </option>
          <option value="vi" lang="vi">
            Tiếng Việt
          </option>
        </select>
        <p className="desktop-help">{text.voicePrivacy}</p>
      </details>
    </div>
  );
}
