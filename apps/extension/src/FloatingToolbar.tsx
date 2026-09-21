import type { UiLanguage } from '@adc/contracts';
import { questionNoticeText, voiceErrorText, voiceLabels } from '@adc/voice-ui';
import { useCallback, useSyncExternalStore } from 'react';
import type { CompanionControls } from './GroundedPanel.tsx';
import {
  companionError,
  companionText,
  structuredText,
} from './structured-strings.ts';

export const floatingText = {
  en: {
    expand: 'Expand companion',
    collapse: 'Collapse companion',
    end: 'End companion',
    expandShort: 'Expand',
    collapseShort: 'Collapse',
    endShort: 'End',
    open: 'Open VSual companion',
    signIn: 'Sign in',
    access: 'Check access',
    setup: 'Set up',
    unsupported: 'Page not supported',
    review: 'Review question',
    answer: 'Answer ready',
    error: 'Check message',
    ask: 'Ask a question',
    ready: 'Ready',
    checking: 'Checking access…',
    unavailable: 'Sign in or check access to use VSual.',
    sidePanel: 'Open side panel',
    fallback:
      'If microphone access is blocked here, use Microphone setup, then try again or use the side panel. Switching surfaces stops current work; drafts are not transferred.',
    standby:
      'Ready for your question. Nothing is recorded or read until you choose.',
    more: 'Expand to review the transcript, answer, evidence or error details.',
    sidePanelFailed:
      'The side panel could not open. Use the browser side-panel menu and select VSual.',
  },
  vi: {
    expand: 'Mở rộng trợ lý',
    collapse: 'Thu gọn trợ lý',
    end: 'Kết thúc trợ lý',
    expandShort: 'Mở rộng',
    collapseShort: 'Thu gọn',
    endShort: 'Kết thúc',
    open: 'Mở trợ lý VSual',
    signIn: 'Đăng nhập',
    access: 'Kiểm tra quyền',
    setup: 'Thiết lập',
    unsupported: 'Chưa hỗ trợ trang',
    review: 'Xem lại câu hỏi',
    answer: 'Có câu trả lời',
    error: 'Xem thông báo',
    ask: 'Đặt câu hỏi',
    ready: 'Sẵn sàng',
    checking: 'Đang kiểm tra quyền truy cập…',
    unavailable: 'Đăng nhập hoặc kiểm tra quyền truy cập để dùng VSual.',
    sidePanel: 'Mở bảng bên',
    fallback:
      'Nếu micrô bị chặn ở đây, dùng Thiết lập micrô rồi thử lại hoặc dùng bảng bên. Chuyển giao diện sẽ dừng thao tác hiện tại; bản nháp không được chuyển theo.',
    standby: 'Sẵn sàng nhận câu hỏi. Chỉ ghi âm hoặc đọc trang khi bạn chọn.',
    more: 'Mở rộng để xem văn bản, câu trả lời, bằng chứng hoặc chi tiết lỗi.',
    sidePanelFailed:
      'Không mở được bảng bên. Mở menu bảng bên của trình duyệt và chọn VSual.',
  },
} as const;

/** Presentation only. Listening and requests still belong to the existing controllers. */
export function useFloatingStatus(controls: CompanionControls | null) {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!controls) return () => {};
      const stops = [
        controls.controller,
        controls.question,
        controls.speech,
      ].map((controller) => controller.subscribe(listener));
      return () => stops.forEach((stop) => stop());
    },
    [controls],
  );
  return useSyncExternalStore(subscribe, () => {
    if (!controls) return 'ready';
    const question = controls.question.getSnapshot();
    const speech = controls.speech.getSnapshot();
    const page = controls.controller.getSnapshot();
    if (
      ['requesting_permission', 'recording', 'transcribing'].includes(
        question.phase,
      ) ||
      ['generating', 'speaking'].includes(speech.phase) ||
      controls.controller.busy
    )
      return 'active';
    if (question.errorCode || speech.errorCode || page.error) return 'error';
    if (page.context?.permission === 'required') return 'setup';
    if (page.context && !page.context.supported) return 'unsupported';
    if (!page.context?.supported) return 'setup';
    if (page.result && !page.stale) return 'answer';
    if (question.text.trim()) return 'review';
    return 'ready';
  });
}

/** A second view of the same controllers, never a second recording/playback host. */
export function FloatingToolbar({
  controls,
  language,
  onExpand,
  onActivity,
}: {
  controls: CompanionControls;
  language: UiLanguage;
  onExpand(): void;
  onActivity(): void;
}) {
  const { controller, question, speech } = controls;
  const page = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const voice = useSyncExternalStore(question.subscribe, question.getSnapshot);
  const audio = useSyncExternalStore(speech.subscribe, speech.getSnapshot);
  const t = floatingText[language];
  const v = voiceLabels(language);
  const structured = page.context?.sourceKind === 'structured_page';
  const g = companionText(language, structured);
  const recording = voice.phase === 'recording';
  const voiceBusy = ['requesting_permission', 'transcribing'].includes(
    voice.phase,
  );
  const answering = page.phase === 'reading' || page.phase === 'understanding';
  const speaking = ['generating', 'speaking'].includes(audio.phase);
  const status = voice.errorCode
    ? voiceErrorText(language, voice.errorCode)
    : page.error
      ? companionError(language, page.error, structured)
      : recording || voiceBusy
        ? questionNoticeText(language, voice.notice)
        : speaking
          ? audio.phase === 'generating'
            ? g.speechPending
            : g.speechPlaying
          : answering
            ? g[page.phase === 'reading' ? 'reading' : 'understanding']
            : !page.context?.supported
              ? structured
                ? page.context?.permission === 'required'
                  ? structuredText[language].activation
                  : structuredText[language].unsupported
                : g.unavailablePage
              : page.result
                ? g.answer
                : voice.text
                  ? questionNoticeText(language, voice.notice)
                  : t.ready;
  return (
    <div className="floating-toolbar">
      <p role="status" aria-atomic="true">
        {status}
      </p>
      <div className="controls">
        <button type="button" onClick={onExpand}>
          {t.ask}
        </button>
        <button
          type="button"
          disabled={voiceBusy || answering}
          data-floating-record
          onClick={() => {
            onActivity();
            if (recording) question.finish();
            else {
              controller.discardAutomaticSpeech();
              speech.stopPlayback();
              void question.start();
            }
          }}
        >
          {recording ? v.questionStop : v.start}
        </button>
        <button
          type="button"
          disabled={!recording && !voiceBusy && !answering}
          data-floating-cancel
          onClick={() => {
            controller.cancel();
            question.cancel();
            speech.cancel();
          }}
        >
          {recording ? v.cancelRecording : v.cancel}
        </button>
        <button
          type="button"
          disabled={!speaking}
          onClick={() => {
            controller.discardAutomaticSpeech();
            speech.stopPlayback();
          }}
        >
          {g.stop}
        </button>
      </div>
      {recording && (
        <p className="field-help">
          {voice.silenceSecondsRemaining === null
            ? v.questionMicrophone
            : v.questionCountdown.replace(
                '{seconds}',
                String(voice.silenceSecondsRemaining),
              )}
        </p>
      )}
      <p className="field-help">
        {page.result || voice.text || voice.errorCode || page.error
          ? t.more
          : t.standby}
      </p>
    </div>
  );
}
