import { useSyncExternalStore } from 'react';
import type { UiLanguage } from '@adc/contracts';
import { DESKTOP_STOP_SHORTCUT, type DesktopState } from '../bridge.ts';
import { type DesktopGuideController, guideCopy } from './guide.ts';

const instructions = {
  en: {
    heading: 'Get started in three steps',
    prepare: 'Choose your application',
    prepareBody:
      'Return to the application you want to ask about. VSual uses a screenshot of that window.',
    ask: 'Use Talk, then speak',
    askBody:
      'Press your Talk shortcut and wait for the listening sound. Pause five seconds to send; speaking again resets the countdown. You can also type a question and select Ask VSual.',
    recordingHelp:
      'Select Stop and review, or press Talk again, to edit before sending. Recording ends at 60 seconds for review.',
    answer: 'Hear the answer or read it',
    answerBody:
      'The answer plays aloud when audio is available. Read the text and supporting evidence at any time. Repeat replays the same audio; Stop silences it immediately.',
    keys: 'Keyboard shortcuts',
    global: 'Works while another app is active',
    local: 'Inside the VSual window',
    talk: 'Talk / review / cancel',
    stop: 'Stop current work and speech',
    hide: 'Hide VSual and stop work',
    next: 'Next / previous control',
    activate: 'Activate the focused button',
    registered: 'Available',
    unavailable: 'Unavailable',
    loading: 'Checking your saved shortcut…',
    loadingStop: 'Checking availability…',
    talkUnavailable:
      'Choose another Talk shortcut in Settings and save. Typed questions remain available.',
    stopUnavailable: 'Use the visible Stop controls, or Escape inside VSual.',
    scope:
      'The saved Talk shortcut is shown here; other shortcut choices are not active at the same time. Change it in Settings. Escape leaves VSual running in the tray and does not sign you out; open menus and dialogs keep their own Escape behaviour.',
    behaviour: 'What Talk does in each state',
    idle: 'Ready',
    idleAction:
      'Starts listening when signed in and workspace access is ready.',
    recording: 'Recording',
    recordingAction:
      'Stops for transcript review; it does not send the question.',
    working: 'Requesting permission or processing',
    workingAction: 'Cancels the current operation.',
    speaking: 'Reading an answer',
    speakingAction:
      'Stops the audio and starts listening for your next question.',
    signedOut: 'Signed out or access unavailable',
    signedOutAction: 'Opens the sign-in or access guidance without recording.',
    backQuestion: 'Back to your question',
  },
  vi: {
    heading: 'Bắt đầu với ba bước',
    prepare: 'Chọn ứng dụng của bạn',
    prepareBody:
      'Quay lại ứng dụng bạn muốn hỏi. VSual sử dụng ảnh chụp cửa sổ đó.',
    ask: 'Dùng phím Nói, rồi đặt câu hỏi',
    askBody:
      'Nhấn phím tắt Nói và chờ âm báo. Ngừng nói năm giây để gửi; nói tiếp sẽ đặt lại thời gian chờ. Bạn cũng có thể nhập câu hỏi rồi chọn Hỏi VSual.',
    recordingHelp:
      'Chọn Dừng và xem lại, hoặc nhấn phím Nói lần nữa, để chỉnh sửa trước khi gửi. Ghi âm kết thúc sau 60 giây để bạn xem lại.',
    answer: 'Nghe hoặc đọc câu trả lời',
    answerBody:
      'Câu trả lời được đọc khi có âm thanh. Bạn luôn có thể đọc văn bản và bằng chứng. Phát lại dùng âm thanh đã tạo; Dừng tắt âm thanh ngay.',
    keys: 'Phím tắt bàn phím',
    global: 'Dùng được khi đang ở ứng dụng khác',
    local: 'Trong cửa sổ VSual',
    talk: 'Nói / xem lại / hủy',
    stop: 'Dừng công việc và giọng đọc',
    hide: 'Ẩn VSual và dừng công việc',
    next: 'Điều khiển tiếp theo / trước đó',
    activate: 'Kích hoạt nút đang được chọn',
    registered: 'Dùng được',
    unavailable: 'Không dùng được',
    loading: 'Đang kiểm tra phím tắt đã lưu…',
    loadingStop: 'Đang kiểm tra khả năng sử dụng…',
    talkUnavailable:
      'Chọn phím tắt Nói khác trong Cài đặt rồi lưu. Bạn vẫn có thể nhập câu hỏi.',
    stopUnavailable: 'Dùng các nút Dừng, hoặc Escape trong cửa sổ VSual.',
    scope:
      'Phím tắt Nói đã lưu được hiển thị ở đây; các lựa chọn khác không hoạt động cùng lúc. Đổi phím trong Cài đặt. Escape giữ VSual ở khay hệ thống và không đăng xuất bạn; menu và hộp thoại đang mở xử lý Escape riêng.',
    behaviour: 'Phím Nói hoạt động thế nào trong từng trạng thái',
    idle: 'Sẵn sàng',
    idleAction:
      'Bắt đầu nghe khi đã đăng nhập và có quyền truy cập không gian làm việc.',
    recording: 'Đang ghi âm',
    recordingAction: 'Dừng để xem lại bản chép lời; không gửi câu hỏi.',
    working: 'Đang xin quyền hoặc xử lý',
    workingAction: 'Hủy thao tác hiện tại.',
    speaking: 'Đang đọc câu trả lời',
    speakingAction: 'Dừng âm thanh và bắt đầu nghe câu hỏi tiếp theo.',
    signedOut: 'Chưa đăng nhập hoặc chưa có quyền truy cập',
    signedOutAction: 'Mở hướng dẫn đăng nhập hoặc truy cập, không ghi âm.',
    backQuestion: 'Quay lại câu hỏi',
  },
} as const;

function Shortcut({ value }: { value: string }) {
  return (
    <kbd className="desktop-shortcut-keys">
      {value.replace('Control', 'Ctrl').replaceAll('+', ' + ')}
    </kbd>
  );
}

export function DesktopGuide({
  controller,
  language,
  onReplay,
  ready,
  desktopState,
}: {
  controller: DesktopGuideController;
  language: UiLanguage;
  onReplay(): void;
  ready: boolean;
  desktopState: DesktopState | null;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const text = guideCopy[language];
  const ui = instructions[language];
  const busy = state.phase === 'loading' || state.phase === 'speaking';
  const status = [
    state.phase === 'idle' || state.phase === 'blocked'
      ? ''
      : text[state.phase],
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className="desktop-guide" aria-labelledby="desktop-welcome-title">
      <div className="desktop-introduction">
        <h2 id="desktop-welcome-title" tabIndex={-1}>
          {text.title}
        </h2>
        <p className="desktop-help">{ui.heading}</p>
        <ol className="desktop-guide-steps">
          <li>
            <h3>{ui.prepare}</h3>
            <p>{ui.prepareBody}</p>
          </li>
          <li>
            <h3>{ui.ask}</h3>
            <p>{ui.askBody}</p>
            <p className="desktop-help">{ui.recordingHelp}</p>
          </li>
          <li>
            <h3>{ui.answer}</h3>
            <p>{ui.answerBody}</p>
          </li>
        </ol>
        <div className="desktop-actions desktop-guide-audio">
          <button
            type="button"
            aria-disabled={busy || !ready}
            aria-describedby="desktop-guide-narration"
            onClick={() => {
              const phase = controller.getSnapshot().phase;
              if (ready && phase !== 'loading' && phase !== 'speaking')
                onReplay();
            }}
          >
            {text.hear}
          </button>
          <button
            type="button"
            aria-disabled={!busy}
            onClick={() => {
              if (busy) controller.interrupt();
            }}
          >
            {text.stop}
          </button>
        </div>
        <p
          className="desktop-guide-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {status}
        </p>
        <p id="desktop-guide-narration" className="desktop-help">
          {ready ? text.provider : text.blocked}
        </p>
      </div>

      <section
        className="desktop-keyboard desktop-hotkeys"
        aria-labelledby="desktop-keyboard-title"
      >
        <h2 id="desktop-keyboard-title">{ui.keys}</h2>
        <h3>{ui.global}</h3>
        <dl className="desktop-keyboard-list">
          <div>
            <dt>{ui.talk}</dt>
            <dd>
              {desktopState ? (
                <>
                  <Shortcut value={desktopState.preferences.shortcut} />
                  <span className="desktop-shortcut-state">
                    {desktopState.shortcutRegistered
                      ? ui.registered
                      : ui.unavailable}
                  </span>
                  {!desktopState.shortcutRegistered && (
                    <p>{ui.talkUnavailable}</p>
                  )}
                </>
              ) : (
                ui.loading
              )}
            </dd>
          </div>
          <div>
            <dt>{ui.stop}</dt>
            <dd>
              <Shortcut value={DESKTOP_STOP_SHORTCUT} />
              <span className="desktop-shortcut-state">
                {!desktopState
                  ? ui.loadingStop
                  : desktopState.stopShortcutRegistered
                    ? ui.registered
                    : ui.unavailable}
              </span>
              {desktopState && !desktopState.stopShortcutRegistered && (
                <p>{ui.stopUnavailable}</p>
              )}
            </dd>
          </div>
        </dl>
        <h3>{ui.local}</h3>
        <dl className="desktop-keyboard-list">
          <div>
            <dt>{ui.hide}</dt>
            <dd>
              <Shortcut value="Escape" />
            </dd>
          </div>
          <div>
            <dt>{ui.next}</dt>
            <dd>
              <Shortcut value="Tab" /> / <Shortcut value="Shift+Tab" />
            </dd>
          </div>
          <div>
            <dt>{ui.activate}</dt>
            <dd>
              <Shortcut value="Enter" /> / <Shortcut value="Space" />
            </dd>
          </div>
        </dl>
        <p className="desktop-help">{ui.scope}</p>
        <section
          className="desktop-talk-details"
          aria-labelledby="desktop-talk-behaviour-title"
        >
          <h3 id="desktop-talk-behaviour-title">{ui.behaviour}</h3>
          <dl className="desktop-talk-states">
            <div>
              <dt>{ui.idle}</dt>
              <dd>{ui.idleAction}</dd>
            </div>
            <div>
              <dt>{ui.recording}</dt>
              <dd>{ui.recordingAction}</dd>
            </div>
            <div>
              <dt>{ui.working}</dt>
              <dd>{ui.workingAction}</dd>
            </div>
            <div>
              <dt>{ui.speaking}</dt>
              <dd>{ui.speakingAction}</dd>
            </div>
            <div>
              <dt>{ui.signedOut}</dt>
              <dd>{ui.signedOutAction}</dd>
            </div>
          </dl>
        </section>
      </section>
      <a className="button-link desktop-guide-return" href="#desktop-assistant">
        {ui.backQuestion}
      </a>
    </section>
  );
}
