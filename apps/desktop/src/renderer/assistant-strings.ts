import { authFailureCodeSchema, type UiLanguage } from '@adc/contracts';
import { authFailureText } from '../../../../packages/voice-ui/src/auth-strings.ts';
import { errorText } from '../../../../packages/voice-ui/src/strings.ts';

const en = {
  title: 'Ask about a window',
  introduction: 'Ask about the window you were using before opening VSual.',
  privacy:
    'Ask VSual sends one screenshot of the selected window’s current view and your question for AI analysis. Private information is not automatically masked. Review the window before asking.',
  scope:
    'VSual sees this screenshot only. It does not read the window’s DOM, retrieve the full file, or see content outside the captured view.',
  signIn: 'Sign in to VSual',
  checking: 'Checking your desktop session…',
  sessionFailure: 'Could not check your desktop session. Try again.',
  account: 'Account',
  separate:
    'This desktop session is separate from the website and browser extension.',
  signOut: 'Sign out',
  signingOut: 'Signing out…',
  retrySession: 'Check access again',
  denied:
    'This account does not have workspace access. Use another account or contact your project maintainer.',
  unavailable:
    'Workspace access could not be checked. Check your connection and try again.',
  logoutOffline:
    'Signed out on this device. The server could not confirm sign-out.',
  sources: 'Window to read',
  activeHelp:
    'Switch to the app you want to read, then press {shortcut} to start listening. While recording, the same shortcut stops for review. While processing, it cancels.',
  activationRequiresAccess:
    'Sign in and check workspace access first. Then return to the app you want to read and press the shortcut again. Recording has not started.',
  sourceReady: 'Ready for your question.',
  noActiveSource:
    'No window is selected. Switch to the app you want to read, then press the VSual shortcut again.',
  refreshing: 'Finding the active window…',
  question: 'Your question',
  questionHelp:
    'Ask about what is visible in the selected window. Answers follow the language of your question; you may also request English or Vietnamese.',
  ask: 'Ask VSual',
  record: 'Record question',
  stopRecord: 'Stop and review',
  cancel: 'Cancel operation',
  clear: 'Clear question',
  recordHelp:
    'After you speak, 5 seconds of silence sends your question and captures the active window. Local tones mark the countdown; speaking again resets it. Stop and review lets you edit before asking. Maximum recording: 60 seconds.',
  recordingLimit:
    '60-second limit reached. Transcribing for review; choose Ask VSual to send.',
  countdown: 'Sending after {seconds} seconds of silence.',
  recordingLanguage: 'Recording language',
  auto: 'Auto detect',
  voicePrivacy:
    'Finished recordings go to ElevenLabs for transcription. Answer text goes to ElevenLabs to generate speech automatically. Provider processing already started may continue after cancellation.',
  speechHelp:
    'Answers are spoken automatically with VSual’s AI voice. NVDA is separate and can read the controls and answer text. Stop answer audio stops VSual audio only.',
  readAnswer: 'Read answer',
  retrySpeech: 'Retry answer audio',
  repeat: 'Play / Repeat answer',
  playAnswer: 'Play answer',
  stopSpeech: 'Stop answer audio',
  audioGenerating: 'Preparing answer audio…',
  audioPlaying: 'Playing answer audio.',
  audioStopped: 'Answer audio stopped.',
  audioBlocked: 'Automatic playback was blocked. Choose Play answer to listen.',
  audioReady: 'Answer audio is ready to repeat.',
  idle: 'Ask a question when the selected window is ready.',
  preparing: 'Preparing the selected window…',
  capturing: 'Capturing one view of the selected window…',
  asking: 'Reading the screenshot…',
  ready: 'Answer ready.',
  cancelled: 'Operation cancelled. Your question is preserved.',
  answer: 'Answer',
  clarification: 'More information needed',
  unsupported: 'Cannot answer from this view',
  captured: 'Captured',
  evidence: 'Screenshot evidence',
  evidenceHelp:
    'Evidence refers to the captured view and may no longer match a window that has changed.',
  image: 'Image',
  region: 'Region (left, top, width, height)',
  reference: 'Request reference',
  requestDetails: 'Request details',
  failureStage: 'Last step',
  errorCode: 'Error code',
  beforeImageSent: 'The screen image was not sent for this request.',
  noEvidence: 'No supporting region was identified in this screenshot.',
  followUps: 'What would you like to explore?',
  followUpHelp:
    'Choose a question below, or use the Talk shortcut and say an option number. Each follow-up sends a fresh screenshot with your previous question and answer as context. Ask something else starts without that context.',
  followUpEmpty:
    'Ask a follow-up in the question field or with the Talk shortcut. VSual sends a fresh screenshot with your previous question and answer as context. Ask something else starts without that context.',
  askSomethingElse: 'Ask something else',
  previousAnswer: 'Previous answer. Your new question is being processed.',
  questionTooLong: 'Shorten your question to 1,000 characters.',
};

const vi: typeof en = {
  title: 'Hỏi về một cửa sổ',
  introduction: 'Hỏi về cửa sổ bạn đang dùng trước khi mở VSual.',
  privacy:
    'Hỏi VSual gửi một ảnh chụp phần đang hiển thị của cửa sổ đã chọn cùng câu hỏi để AI phân tích. Thông tin riêng tư không được tự động che. Hãy kiểm tra cửa sổ trước khi hỏi.',
  scope:
    'VSual chỉ xem ảnh chụp này. Ứng dụng không đọc DOM của cửa sổ, không lấy toàn bộ tệp và không thấy nội dung ngoài vùng đã chụp.',
  signIn: 'Đăng nhập VSual',
  checking: 'Đang kiểm tra phiên đăng nhập trên máy tính…',
  sessionFailure:
    'Không thể kiểm tra phiên đăng nhập trên máy tính. Hãy thử lại.',
  account: 'Tài khoản',
  separate:
    'Phiên đăng nhập trên máy tính độc lập với trang web và tiện ích trình duyệt.',
  signOut: 'Đăng xuất',
  signingOut: 'Đang đăng xuất…',
  retrySession: 'Kiểm tra lại quyền truy cập',
  denied:
    'Tài khoản này chưa có quyền truy cập không gian làm việc. Dùng tài khoản khác hoặc liên hệ người quản lý dự án.',
  unavailable:
    'Chưa thể kiểm tra quyền truy cập. Kiểm tra kết nối rồi thử lại.',
  logoutOffline:
    'Đã đăng xuất trên thiết bị này. Máy chủ chưa xác nhận đăng xuất.',
  sources: 'Cửa sổ cần đọc',
  activeHelp:
    'Chuyển đến ứng dụng bạn muốn đọc, rồi nhấn {shortcut} để bắt đầu nghe. Khi đang ghi âm, nhấn lại để dừng và xem lại. Khi đang xử lý, nhấn để hủy.',
  activationRequiresAccess:
    'Hãy đăng nhập và kiểm tra quyền truy cập trước. Sau đó quay lại ứng dụng cần đọc và nhấn lại phím tắt. Chưa bắt đầu ghi âm.',
  sourceReady: 'Sẵn sàng nhận câu hỏi.',
  noActiveSource:
    'Chưa chọn cửa sổ. Chuyển đến ứng dụng bạn muốn đọc, rồi nhấn lại phím tắt VSual.',
  refreshing: 'Đang tìm cửa sổ đang hoạt động…',
  question: 'Câu hỏi của bạn',
  questionHelp:
    'Hỏi về nội dung đang hiển thị trong cửa sổ đã chọn. Câu trả lời theo ngôn ngữ câu hỏi; bạn cũng có thể yêu cầu tiếng Anh hoặc tiếng Việt.',
  ask: 'Hỏi VSual',
  record: 'Ghi âm câu hỏi',
  stopRecord: 'Dừng và xem lại',
  cancel: 'Hủy thao tác',
  clear: 'Xóa câu hỏi',
  recordHelp:
    'Sau khi bạn nói, im lặng 5 giây sẽ gửi câu hỏi và chụp cửa sổ đang hoạt động. Âm báo trên thiết bị đánh dấu đếm ngược; nói tiếp sẽ đặt lại. Dừng và xem lại cho phép sửa trước khi hỏi. Ghi âm tối đa 60 giây.',
  recordingLimit:
    'Đã đủ 60 giây. Đang chép lời để xem lại; chọn Hỏi VSual để gửi.',
  countdown: 'Tự gửi sau {seconds} giây im lặng.',
  recordingLanguage: 'Ngôn ngữ ghi âm',
  auto: 'Tự động nhận dạng',
  voicePrivacy:
    'Bản ghi hoàn tất được gửi đến ElevenLabs để chép lời. Văn bản trả lời được gửi đến ElevenLabs để tự động tạo giọng đọc. Xử lý đã bắt đầu ở nhà cung cấp có thể tiếp tục sau khi hủy.',
  speechHelp:
    'Câu trả lời được tự động đọc bằng giọng AI của VSual. NVDA hoạt động độc lập và có thể đọc các nút điều khiển cùng văn bản trả lời. Dừng âm thanh trả lời chỉ dừng âm thanh VSual.',
  readAnswer: 'Đọc câu trả lời',
  retrySpeech: 'Thử lại âm thanh trả lời',
  repeat: 'Phát / Lặp lại câu trả lời',
  playAnswer: 'Phát câu trả lời',
  stopSpeech: 'Dừng âm thanh trả lời',
  audioGenerating: 'Đang tạo âm thanh trả lời…',
  audioPlaying: 'Đang phát âm thanh trả lời.',
  audioStopped: 'Đã dừng âm thanh trả lời.',
  audioBlocked:
    'Trình phát đã chặn phát tự động. Chọn Phát câu trả lời để nghe.',
  audioReady: 'Âm thanh trả lời sẵn sàng để phát lại.',
  idle: 'Đặt câu hỏi khi cửa sổ đã chọn sẵn sàng.',
  preparing: 'Đang chuẩn bị cửa sổ đã chọn…',
  capturing: 'Đang chụp một phần hiển thị của cửa sổ đã chọn…',
  asking: 'Đang đọc ảnh chụp màn hình…',
  ready: 'Câu trả lời đã sẵn sàng.',
  cancelled: 'Đã hủy thao tác. Câu hỏi của bạn được giữ lại.',
  answer: 'Câu trả lời',
  clarification: 'Cần thêm thông tin',
  unsupported: 'Không thể trả lời từ phần hiển thị này',
  captured: 'Thời điểm chụp',
  evidence: 'Dẫn chứng từ ảnh chụp',
  evidenceHelp:
    'Dẫn chứng thuộc ảnh đã chụp và có thể không còn khớp nếu cửa sổ đã thay đổi.',
  image: 'Ảnh',
  region: 'Vùng (trái, trên, rộng, cao)',
  reference: 'Mã tham chiếu yêu cầu',
  requestDetails: 'Chi tiết yêu cầu',
  failureStage: 'Bước cuối',
  errorCode: 'Mã lỗi',
  beforeImageSent: 'Ảnh màn hình chưa được gửi trong yêu cầu này.',
  noEvidence: 'Không xác định được vùng dẫn chứng trong ảnh chụp này.',
  followUps: 'Bạn muốn tìm hiểu thêm điều gì?',
  followUpHelp:
    'Chọn câu hỏi bên dưới, hoặc dùng phím tắt Nói rồi nói số lựa chọn. Mỗi câu hỏi tiếp theo gửi ảnh chụp mới cùng câu hỏi và câu trả lời trước làm ngữ cảnh. Hỏi điều khác bắt đầu không dùng ngữ cảnh đó.',
  followUpEmpty:
    'Nhập câu hỏi tiếp theo hoặc dùng phím tắt Nói. VSual gửi ảnh chụp mới cùng câu hỏi và câu trả lời trước làm ngữ cảnh. Hỏi điều khác bắt đầu không dùng ngữ cảnh đó.',
  askSomethingElse: 'Hỏi điều khác',
  previousAnswer: 'Câu trả lời trước. Đang xử lý câu hỏi mới của bạn.',
  questionTooLong: 'Rút ngắn câu hỏi còn tối đa 1.000 ký tự.',
};
export const assistantText = { en, vi };

/** Screen errors must not be mislabeled as ElevenLabs or sign-in failures. */
export function screenError(code: string, language: UiLanguage): string {
  const messages: Record<string, [string, string]> = {
    invalid_choice: [
      'Choose one of the numbered questions currently shown, or ask your own question. No screenshot or answer request was sent.',
      'Chọn một câu hỏi được đánh số đang hiển thị, hoặc đặt câu hỏi của bạn. Chưa gửi ảnh chụp hay yêu cầu trả lời.',
    ],
    source_changed: [
      'The window changed. The previous answer and choices were cleared; your question was not sent. Review your question for the new window before asking again.',
      'Cửa sổ đã thay đổi. Đã xóa câu trả lời và lựa chọn trước; chưa gửi câu hỏi. Hãy xem lại câu hỏi cho cửa sổ mới trước khi hỏi tiếp.',
    ],
    provider_failure: [
      'The screen-reading service could not complete the answer. Your question is preserved. Request details below can help identify the cause.',
      'Dịch vụ đọc màn hình chưa thể hoàn tất câu trả lời. Câu hỏi được giữ lại. Chi tiết yêu cầu bên dưới giúp xác định nguyên nhân.',
    ],
    setup_required: [
      'Screen reading is not configured on the backend. Ask the project maintainer to check its connection and visual model settings.',
      'Máy chủ chưa được cấu hình để đọc màn hình. Nhờ người quản lý kiểm tra kết nối và cài đặt mô hình đọc ảnh.',
    ],
    timeout: [
      'The screen-reading request timed out. Your question is preserved; try again when ready.',
      'Yêu cầu đọc màn hình đã hết thời gian chờ. Câu hỏi được giữ lại; bạn có thể thử lại.',
    ],
    invalid_input: [
      'The captured screen request was not accepted. Activate the intended window again and retry. Your question is preserved.',
      'Yêu cầu đọc ảnh màn hình chưa được chấp nhận. Mở lại VSual từ cửa sổ cần đọc rồi thử lại. Câu hỏi được giữ lại.',
    ],
    input_too_large: [
      'The screenshot, question or previous exchange exceeds the request limit. Try a smaller window or shorter question, or choose Ask something else to start without the previous exchange. Your question is preserved until you clear it.',
      'Ảnh chụp, câu hỏi hoặc lượt trao đổi trước vượt giới hạn yêu cầu. Thử thu nhỏ cửa sổ hoặc rút ngắn câu hỏi, hoặc chọn Hỏi điều khác để bắt đầu không dùng lượt trao đổi trước. Câu hỏi được giữ lại cho đến khi bạn xóa.',
    ],
    cancelled: [
      'Screen reading was cancelled. Your question is preserved.',
      'Đã hủy đọc màn hình. Câu hỏi được giữ lại.',
    ],
    forbidden: [
      'Your current account or workspace does not allow this screen-reading request. Check access or sign in with an authorised account.',
      'Tài khoản hoặc không gian làm việc hiện tại chưa cho phép yêu cầu đọc màn hình này. Kiểm tra quyền hoặc đăng nhập bằng tài khoản được phép.',
    ],
    provider_rate_limited: [
      'The screen-reading provider temporarily limited this request. Retry later; your question is preserved.',
      'Nhà cung cấp đọc màn hình tạm giới hạn yêu cầu này. Thử lại sau; câu hỏi được giữ lại.',
    ],
    quota_exhausted: [
      'The screen-reading provider has insufficient allowance for this request. Your question is preserved.',
      'Nhà cung cấp đọc màn hình không đủ hạn mức cho yêu cầu này. Câu hỏi được giữ lại.',
    ],
  };
  const message = messages[code];
  return message
    ? message[language === 'vi' ? 1 : 0]
    : desktopError(code, language);
}

export function desktopError(code: string, language: UiLanguage): string {
  const auth = authFailureCodeSchema.safeParse(code.toUpperCase());
  if (auth.success) return authFailureText(auth.data, language);
  const messages: Record<string, [string, string]> = {
    source_required: [
      'Switch to the app you want to read, then press the VSual shortcut before asking or recording.',
      'Chuyển đến ứng dụng bạn muốn đọc, rồi nhấn phím tắt VSual trước khi hỏi hoặc ghi âm.',
    ],
    source_unavailable: [
      'The window is no longer available. Switch to the app you want to read and press the VSual shortcut again.',
      'Cửa sổ không còn khả dụng. Chuyển đến ứng dụng bạn muốn đọc rồi nhấn lại phím tắt VSual.',
    ],
    capture_failed: [
      'Could not capture the selected window. Check that it is open and try again.',
      'Không thể chụp cửa sổ đã chọn. Kiểm tra cửa sổ đang mở rồi thử lại.',
    ],
    capture_denied: [
      'Screen capture was not allowed. Switch to the app and press the VSual shortcut to try again.',
      'Chưa được phép chụp màn hình. Chuyển đến ứng dụng rồi nhấn phím tắt VSual để thử lại.',
    ],
    capture_timeout: [
      'The screen capture timed out. Check the selected window and try again.',
      'Đã hết thời gian chụp màn hình. Kiểm tra cửa sổ đã chọn rồi thử lại.',
    ],
    capture_unavailable: [
      'Screen capture is unavailable. Check the selected window and try again.',
      'Chức năng chụp màn hình chưa khả dụng. Kiểm tra cửa sổ đã chọn rồi thử lại.',
    ],
    invalid_question: [
      'Enter a question of up to 1,000 characters.',
      'Nhập câu hỏi dài tối đa 1.000 ký tự.',
    ],
    invalid_response: [
      'The answer could not be verified. Ask again for a fresh capture.',
      'Không thể xác minh câu trả lời. Hỏi lại để chụp ảnh mới.',
    ],
  };
  const message = messages[code];
  return message
    ? message[language === 'vi' ? 1 : 0]
    : errorText(language, code);
}
