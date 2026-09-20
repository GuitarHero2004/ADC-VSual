import type { UiLanguage } from '@adc/contracts';
import type { VoiceNotice } from './controller.ts';

const en = {
  heading: 'Voice test',
  questionHeading: 'Your question',
  questionHelp:
    'Compare two months of completed orders. Review, then choose Ask VSual.',
  questionCharacters: 'characters',
  questionTooLong: 'Shorten your question to 1,000 characters before asking.',
  questionRecord: 'Record question',
  questionStop: 'Stop recording',
  questionClear: 'Clear question',
  questionUnavailable:
    'Wait for this request to finish or cancel it before recording.',
  questionMicrophone:
    'Optional recording, up to 30 seconds. Stop transcribes; Cancel discards.',
  questionProcessing: 'Finished recordings go to ElevenLabs for transcription.',
  questionPrivacy:
    'Review the transcript before asking. Recordings are not saved to Supabase. ElevenLabs may retain them under its own policy.',
  explanation:
    'Record or type, then hear your text read back. This test does not answer questions or read pages.',
  uiLanguage: 'Interface language',
  recognitionLanguage: 'Recognition and speech language',
  languageHelp:
    'Auto detects the spoken language. Your text is not translated.',
  auto: 'Auto detect',
  start: 'Start recording',
  finish: 'Finish and transcribe',
  cancelRecording: 'Cancel recording',
  cancel: 'Cancel operation',
  microphone:
    'Allow microphone access when asked. Record up to 30 seconds; transcription follows when you finish.',
  transcript: 'Transcript or typed text',
  transcriptHelp:
    'Review and edit before read-back. Your text is kept as supplied.',
  characters: 'characters for read-back',
  tooLong: 'Shorten the text to 1,000 characters before read-back.',
  read: 'Read back',
  play: 'Play / Repeat',
  stop: 'Stop playback',
  clear: 'Clear text and audio',
  speech: 'Enable app-generated speech',
  speechHelp:
    'Leave off to use your own screen reader. Generated speech is AI-generated.',
  cues: 'Play a short local recording-start cue',
  speed: 'Playback speed',
  replayHelp:
    'Repeat and speed changes reuse the audio. Editing text or changing language clears it.',
  processing:
    'ElevenLabs processes finished recordings and text you choose to read back.',
  privacyDetails: 'Voice privacy and controls',
  privacy:
    'Recordings, text and generated speech stay in this app only for the session; they are not saved to Supabase. ElevenLabs may retain submitted data under its own policy.',
  privacyLink: 'ElevenLabs privacy policy',
  cancellation:
    'Escape cancels local work. Provider processing or charges already started may continue.',
  unavailable: 'Sign in to use the voice test.',
  loading: 'Preparing voice controls…',
  retry: 'No speech recognised. Start recording to try again, or type below.',
};
type Labels = typeof en;
const vi: Labels = {
  heading: 'Thử giọng nói',
  questionHeading: 'Câu hỏi của bạn',
  questionHelp:
    'So sánh số đơn hoàn thành giữa hai tháng. Kiểm tra rồi chọn Hỏi VSual.',
  questionCharacters: 'ký tự',
  questionTooLong: 'Rút ngắn câu hỏi còn tối đa 1.000 ký tự trước khi hỏi.',
  questionRecord: 'Ghi âm câu hỏi',
  questionStop: 'Dừng ghi âm',
  questionClear: 'Xóa câu hỏi',
  questionUnavailable: 'Chờ yêu cầu hoàn tất hoặc hủy trước khi ghi âm.',
  questionMicrophone:
    'Ghi âm tùy chọn, tối đa 30 giây. Dừng để chép lời; Hủy để bỏ bản ghi.',
  questionProcessing:
    'Bản ghi khi kết thúc được gửi đến ElevenLabs để chép lời.',
  questionPrivacy:
    'Kiểm tra văn bản trước khi hỏi. Bản ghi không lưu vào Supabase. ElevenLabs có thể lưu theo chính sách riêng.',
  explanation:
    'Ghi âm hoặc nhập, rồi nghe đọc lại văn bản. Phần thử này không trả lời câu hỏi hay đọc trang web.',
  uiLanguage: 'Ngôn ngữ giao diện',
  recognitionLanguage: 'Ngôn ngữ nhận dạng và đọc',
  languageHelp: 'Tự động nhận dạng ngôn ngữ nói. Văn bản không được dịch.',
  auto: 'Tự động nhận dạng',
  start: 'Bắt đầu ghi âm',
  finish: 'Kết thúc và chuyển thành văn bản',
  cancelRecording: 'Hủy ghi âm',
  cancel: 'Hủy thao tác',
  microphone:
    'Cho phép micrô khi được hỏi. Ghi tối đa 30 giây; văn bản được tạo sau khi kết thúc.',
  transcript: 'Bản chép lời hoặc nội dung nhập',
  transcriptHelp:
    'Kiểm tra và sửa trước khi đọc lại. Văn bản được giữ nguyên như bạn cung cấp.',
  characters: 'ký tự để đọc lại',
  tooLong: 'Rút gọn nội dung còn tối đa 1.000 ký tự trước khi đọc lại.',
  read: 'Đọc lại',
  play: 'Phát / Lặp lại',
  stop: 'Dừng phát',
  clear: 'Xóa văn bản và âm thanh',
  speech: 'Bật giọng nói của ứng dụng',
  speechHelp:
    'Tắt để dùng trình đọc màn hình của bạn. Giọng nói được tạo bằng AI.',
  cues: 'Phát âm báo ngắn khi bắt đầu ghi âm',
  speed: 'Tốc độ phát',
  replayHelp:
    'Lặp lại và đổi tốc độ dùng lại âm thanh. Sửa văn bản hoặc đổi ngôn ngữ sẽ xóa âm thanh đó.',
  processing:
    'ElevenLabs xử lý bản ghi đã kết thúc và văn bản bạn chọn đọc lại.',
  privacyDetails: 'Quyền riêng tư và điều khiển giọng nói',
  privacy:
    'Bản ghi, văn bản và âm thanh chỉ được giữ trong phiên ứng dụng này, không lưu vào Supabase. ElevenLabs có thể lưu dữ liệu theo chính sách riêng.',
  privacyLink: 'Chính sách quyền riêng tư của ElevenLabs',
  cancellation:
    'Escape hủy thao tác trên thiết bị. Việc xử lý hoặc tính phí đã bắt đầu ở nhà cung cấp có thể tiếp tục.',
  unavailable: 'Đăng nhập để thử giọng nói.',
  loading: 'Đang chuẩn bị điều khiển giọng nói…',
  retry:
    'Không nhận dạng được lời nói. Bắt đầu ghi âm để thử lại hoặc nhập bên dưới.',
};

const notices: Record<UiLanguage, Record<VoiceNotice, string>> = {
  en: {
    idle: 'Ready to record or type.',
    requesting_permission: 'Waiting for microphone permission. You can cancel.',
    recording: 'Recording. Finish to transcribe, or Cancel to discard.',
    transcribing: 'Transcribing your recording…',
    ready: 'Text ready for review.',
    generating: 'Generating read-back speech…',
    speaking: 'Playing read-back.',
    cancelled: 'Cancelled. Your text is preserved.',
    error: 'The operation could not finish.',
    duration_reached: '30-second limit reached. Transcribing your recording…',
    no_speech: en.retry,
    play_ready: 'Audio ready. Select Play / Repeat to listen.',
    stopped: 'Playback stopped.',
    cleared: 'Text and audio cleared.',
  },
  vi: {
    idle: 'Sẵn sàng ghi âm hoặc nhập.',
    requesting_permission: 'Đang chờ quyền micrô. Bạn có thể hủy.',
    recording: 'Đang ghi âm. Kết thúc để chép lời hoặc Hủy để bỏ bản ghi.',
    transcribing: 'Đang chuyển bản ghi thành văn bản…',
    ready: 'Văn bản sẵn sàng để kiểm tra.',
    generating: 'Đang tạo giọng đọc…',
    speaking: 'Đang phát giọng đọc.',
    cancelled: 'Đã hủy. Văn bản được giữ lại.',
    error: 'Không thể hoàn tất thao tác.',
    duration_reached: 'Đã đủ 30 giây. Đang chuyển bản ghi thành văn bản…',
    no_speech: vi.retry,
    play_ready: 'Âm thanh sẵn sàng. Chọn Phát / Lặp lại để nghe.',
    stopped: 'Đã dừng phát.',
    cleared: 'Đã xóa văn bản và âm thanh.',
  },
};

const errors: Record<string, [string, string]> = {
  auth_unavailable: [
    'Your session cannot be checked right now. Check your connection and retry. You have not been signed out.',
    'Chưa thể kiểm tra phiên. Kiểm tra kết nối rồi thử lại. Bạn chưa bị đăng xuất.',
  ],
  microphone_denied: [
    'Microphone access was denied. Allow it in this surface’s browser permissions, then try again. You can still type.',
    'Quyền micrô bị từ chối. Cho phép trong quyền của trình duyệt cho giao diện này rồi thử lại. Bạn vẫn có thể nhập.',
  ],
  microphone_missing: [
    'No microphone found. Connect one or type your text.',
    'Không tìm thấy micrô. Kết nối micrô hoặc nhập nội dung.',
  ],
  microphone_unavailable: [
    'Microphone access is unavailable. Use HTTPS or localhost and a supported browser, or type your text.',
    'Không thể truy cập micrô. Dùng HTTPS hoặc localhost và trình duyệt hỗ trợ, hoặc nhập nội dung.',
  ],
  recording_unavailable: [
    'This browser does not support a compatible recording format. You can type instead.',
    'Trình duyệt không hỗ trợ định dạng ghi âm phù hợp. Bạn có thể nhập thay thế.',
  ],
  recording_failed: [
    'Recording failed. Check your microphone and try again.',
    'Ghi âm thất bại. Kiểm tra micrô rồi thử lại.',
  ],
  audio_too_large: [
    'Recording exceeded 3 MiB and was discarded without upload. Try a shorter recording.',
    'Bản ghi vượt quá 3 MiB, đã bị bỏ và chưa gửi đi. Hãy ghi ngắn hơn.',
  ],
  empty_audio: [
    'The recording was empty. Try recording again.',
    'Bản ghi không có dữ liệu. Hãy thử ghi lại.',
  ],
  invalid_text: [
    'Enter between 1 and 1,000 characters for read-back.',
    'Nhập từ 1 đến 1.000 ký tự để đọc lại.',
  ],
  unauthenticated: [
    'Your session expired. Sign in again before retrying.',
    'Phiên đã hết hạn. Đăng nhập lại trước khi thử.',
  ],
  forbidden: [
    'This account does not have access to voice testing.',
    'Tài khoản này chưa có quyền thử giọng nói.',
  ],
  invalid_input: [
    'Check the supplied text or recording and try again.',
    'Kiểm tra văn bản hoặc bản ghi rồi thử lại.',
  ],
  payload_too_large: [
    'The recording or text is too large. Shorten it and try again.',
    'Bản ghi hoặc văn bản quá lớn. Rút ngắn rồi thử lại.',
  ],
  input_too_large: [
    'The recording or text is too large. Shorten it and try again.',
    'Bản ghi hoặc văn bản quá lớn. Rút ngắn rồi thử lại.',
  ],
  duplicate_request: [
    'This request was already submitted. Review the current result before trying again.',
    'Yêu cầu này đã được gửi. Kiểm tra kết quả hiện tại trước khi thử lại.',
  ],
  setup_required: [
    'Voice service setup is incomplete. Ask the project maintainer to finish configuration. Your text is preserved.',
    'Dịch vụ giọng nói chưa được cấu hình đầy đủ. Nhờ người quản lý dự án hoàn tất. Văn bản được giữ lại.',
  ],
  provider_access_required: [
    'ElevenLabs does not allow this voice request on the current plan. Ask the project maintainer to select an eligible voice or change the plan. Your text is preserved.',
    'ElevenLabs không cho phép yêu cầu giọng đọc này với gói hiện tại. Nhờ người quản lý dự án chọn giọng được hỗ trợ hoặc đổi gói. Văn bản được giữ lại.',
  ],
  rate_limited: [
    'The usage limit was reached. Wait before retrying; your text is preserved.',
    'Đã đạt giới hạn sử dụng. Chờ trước khi thử lại; văn bản được giữ lại.',
  ],
  quota_exhausted: [
    'The voice service allowance has been used. Your text is preserved; ask the maintainer about availability.',
    'Đã dùng hết hạn mức dịch vụ giọng nói. Văn bản được giữ lại; hỏi người quản lý về khả năng sử dụng.',
  ],
  provider_failure: [
    'The voice service could not finish. Your text is preserved. Try again later.',
    'Dịch vụ giọng nói không hoàn tất. Văn bản được giữ lại. Thử lại sau.',
  ],
  timeout: [
    'The voice request timed out. Your text is preserved. Try again when ready.',
    'Yêu cầu giọng nói đã hết thời gian chờ. Văn bản được giữ lại. Bạn có thể thử lại.',
  ],
  cancelled: [
    'Request cancelled. Your text is preserved.',
    'Đã hủy yêu cầu. Văn bản được giữ lại.',
  ],
  playback_failed: [
    'Audio could not play. Try Play / Repeat, or generate it again after editing.',
    'Không thể phát âm thanh. Thử Phát / Lặp lại hoặc sửa nội dung để tạo lại.',
  ],
  deployment_protected: [
    'The deployment is protected by Vercel. Its access protection must allow this request; signing into this app alone cannot unlock it.',
    'Bản triển khai được Vercel bảo vệ. Cần cho phép yêu cầu qua lớp bảo vệ này; chỉ đăng nhập ứng dụng không mở được.',
  ],
  request_failed: [
    'The request could not finish. Check your connection and try again. Your text is preserved.',
    'Không thể hoàn tất yêu cầu. Kiểm tra kết nối rồi thử lại. Văn bản được giữ lại.',
  ],
  backend_unavailable: [
    'Cannot reach the voice backend. Check your connection, extension backend URL and allowed origins. Vercel deployment protection may also block this request.',
    'Không thể kết nối máy chủ giọng nói. Kiểm tra kết nối, địa chỉ máy chủ của tiện ích và nguồn được phép. Lớp bảo vệ bản triển khai Vercel cũng có thể chặn yêu cầu này.',
  ],
};

export function labels(language: UiLanguage): Labels {
  return language === 'vi' ? vi : en;
}
export function noticeText(language: UiLanguage, notice: VoiceNotice): string {
  return notices[language][notice];
}
export function questionNoticeText(
  language: UiLanguage,
  notice: VoiceNotice,
): string {
  const messages: Partial<Record<VoiceNotice, [string, string]>> = {
    recording: [
      'Recording started. Stop to transcribe, or Cancel to discard.',
      'Đã bắt đầu ghi âm. Dừng để chuyển thành văn bản hoặc Hủy để bỏ bản ghi.',
    ],
    transcribing: [
      'Transcribing your question.',
      'Đang chuyển câu hỏi thành văn bản.',
    ],
    ready: [
      'Your question is ready to review.',
      'Câu hỏi đã sẵn sàng để kiểm tra.',
    ],
    no_speech: [
      'No speech recognised. Record again or type your question.',
      'Không nhận dạng được lời nói. Ghi âm lại hoặc nhập câu hỏi.',
    ],
    cleared: ['Question cleared.', 'Đã xóa câu hỏi.'],
  };
  const message = messages[notice];
  return message
    ? message[language === 'vi' ? 1 : 0]
    : noticeText(language, notice);
}
export function errorText(language: UiLanguage, code: string): string {
  const entry = errors[code] ?? errors.request_failed!;
  return entry[language === 'vi' ? 1 : 0];
}
