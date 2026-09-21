import type { UiLanguage } from '@adc/contracts';

export const groundedText = {
  en: {
    readyPage: 'Ready on this page.',
    processingNotice:
      'Asking reads this orders table and sends it with your question to VSual. Avis interprets the question; VSual calculates from the captured rows.',
    unavailablePage:
      'The current page could not be checked. Check browser site access for VSual, then try again.',
    askAnother: 'Ask another question',
    goAnswer: 'Go to answer',
    answerReady: 'Answer ready.',
    clarification: 'Review this clarification and edit your question.',
    tableReady: 'Source table ready.',
    inspect: 'Inspect the source table without AI',
    closeEvidence: 'Close evidence',
    playback: 'Answer speech',
    speechOff:
      'App speech is off. Enable it in Settings or use your screen reader.',
    readAgain: 'Read again',
    speechStopped: 'Speech stopped.',
    answerSpeechFailed:
      'The text answer is available, but its audio could not be generated or played.',
    voiceHeld:
      'Transcript ready. The question was not sent; see the explanation below.',
    voiceHeldBusy:
      'Your recording was transcribed, but another question is still being processed. Wait for it to finish or cancel it, then select Ask VSual to send this transcript.',
    voiceHeldPage:
      'Your recording was transcribed, but the question was not sent because a supported orders page could not be confirmed. Open the configured orders dashboard, check the active page and its permission, then select Ask VSual.',
    voiceHeldLength:
      'Your recording was transcribed, but the question was not sent because it exceeds 1,000 characters. Shorten it, then select Ask VSual.',
    speechPlaying: 'Reading the answer.',
    typingHelp:
      'Type a question to read this page. Microphone setup is optional and available in Settings.',
    page: 'Current page',
    supported: 'Supported orders dashboard',
    unsupported: 'This page is not supported. Open the orders demo.',
    checking: 'Checking the active tab…',
    scope:
      'Compare completed-order counts for one region and two months. VSual does not change the page.',
    permissionHelp: 'Supported demo:',
    recheck: 'Check active page',
    recheckHelp:
      'Select the demo tab, then check again. Checking does not read page content.',
    notice:
      'Allow VSual to read the displayed orders table and its region/year context on this origin. When you ask, our backend processes the question and captured rows. Only your question and necessary scope context go through Avis to the configured model provider; our application calculates from the row counts. We save no page content or answers in our database. Inspecting the table alone makes no AI request. Avis and the model provider may retain submitted data under their own policies.',
    ask: 'Ask VSual',
    sample: 'Use example question',
    sampleText: 'Compare completed orders in the South for August and July.',
    cancel: 'Cancel request',
    answer: 'Answer',
    evidence: 'Evidence',
    viewEvidence: 'View evidence',
    table: 'Captured source table',
    viewTable: 'View captured table',
    capture: 'Capture source table',
    refresh: 'Capture again',
    back: 'Back to answer',
    previous:
      'Previous captured data — the page or tab changed. Capture again before asking about the current page.',
    captured: 'Captured',
    read: 'Read answer',
    stop: 'Stop speech',
    repeat: 'Play / Repeat',
    speech: 'Speech on',
    speechHelp:
      'New answers are read automatically using AI-generated speech. Turn off to use your screen reader. This does not control NVDA.',
    playAnswer: 'Play answer',
    retrySpeech: 'Retry speech',
    playbackBlocked: 'Automatic playback was blocked. Select Play answer.',
    return: 'Return to page',
    returned: 'Returned to the source page.',
    fallback:
      'The original focus target was unavailable. Returned to the page heading.',
    returnFailed:
      'Could not return to the source page. Select the orders tab using the browser.',
    month: 'Period',
    value: 'Displayed completed orders',
    row: 'Source row',
    region: 'Region',
    year: 'Year',
    unit: 'Unit: orders',
    capturedOnly: 'Based on captured synthetic orders.',
    idle: 'Review your question before asking.',
    reading: 'Reading the dashboard…',
    understanding: 'Understanding your question…',
    ready: 'Answer or source table ready.',
    cancelled: 'Request cancelled. You can ask again.',
    empty:
      'Your answer will appear here after you ask. You can inspect the source table without AI.',
    privacy: 'Avis privacy policy (PDF)',
    speechPending:
      'Preparing audio. You can stop speech or inspect the answer.',
  },
  vi: {
    processingNotice:
      'Khi hỏi, bảng đơn hàng và câu hỏi được gửi đến VSual. Avis hiểu câu hỏi; VSual tính toán từ các dòng đã đọc.',
    readyPage: 'Sẵn sàng trên trang này.',
    unavailablePage:
      'Chưa kiểm tra được trang hiện tại. Kiểm tra quyền truy cập trang của VSual trong trình duyệt rồi thử lại.',
    askAnother: 'Hỏi câu khác',
    goAnswer: 'Đến câu trả lời',
    answerReady: 'Câu trả lời đã sẵn sàng.',
    clarification: 'Xem hướng dẫn làm rõ và chỉnh sửa câu hỏi.',
    tableReady: 'Bảng nguồn đã sẵn sàng.',
    inspect: 'Xem bảng nguồn không dùng AI',
    closeEvidence: 'Đóng dữ liệu đối chiếu',
    playback: 'Giọng đọc câu trả lời',
    speechOff:
      'Giọng đọc đang tắt. Bật trong Cài đặt hoặc dùng trình đọc màn hình.',
    readAgain: 'Đọc lại',
    speechStopped: 'Đã dừng giọng đọc.',
    answerSpeechFailed:
      'Câu trả lời dạng chữ vẫn còn, nhưng chưa thể tạo hoặc phát âm thanh.',
    voiceHeld: 'Đã có văn bản. Câu hỏi chưa được gửi; xem giải thích bên dưới.',
    voiceHeldBusy:
      'Đã chép lời, nhưng câu hỏi khác vẫn đang được xử lý. Chờ hoàn tất hoặc hủy rồi chọn Hỏi VSual để gửi văn bản này.',
    voiceHeldPage:
      'Đã chép lời, nhưng chưa gửi câu hỏi vì chưa xác nhận được trang đơn hàng hỗ trợ. Mở bảng đơn hàng đã cấu hình, kiểm tra thẻ và quyền xử lý rồi chọn Hỏi VSual.',
    voiceHeldLength:
      'Đã chép lời, nhưng chưa gửi câu hỏi vì dài hơn 1.000 ký tự. Rút ngắn rồi chọn Hỏi VSual.',
    speechPlaying: 'Đang đọc câu trả lời.',
    typingHelp:
      'Nhập câu hỏi để đọc trang này. Micro là tùy chọn và có thể thiết lập trong Cài đặt.',
    page: 'Trang hiện tại',
    supported: 'Bảng đơn hàng được hỗ trợ',
    unsupported: 'Trang này chưa được hỗ trợ. Hãy mở bản mẫu đơn hàng.',
    checking: 'Đang kiểm tra thẻ đang mở…',
    scope:
      'So sánh số đơn hoàn thành của một khu vực trong hai tháng. VSual không thay đổi trang.',
    permissionHelp: 'Bản mẫu được hỗ trợ:',
    recheck: 'Kiểm tra thẻ đang mở',
    recheckHelp:
      'Chọn thẻ bản mẫu rồi kiểm tra lại. Kiểm tra không đọc nội dung trang.',
    notice:
      'Cho phép VSual đọc bảng đơn hàng và ngữ cảnh khu vực/năm đang hiển thị trên nguồn này. Khi bạn hỏi, máy chủ xử lý câu hỏi và các dòng đã đọc. Chỉ câu hỏi và phạm vi cần thiết đi qua Avis đến nhà cung cấp mô hình đã cấu hình; ứng dụng tự tính từ số đơn. Chúng tôi không lưu nội dung trang hoặc câu trả lời vào cơ sở dữ liệu của ứng dụng. Chỉ xem bảng nguồn không gọi AI. Avis và nhà cung cấp mô hình có thể lưu dữ liệu đã gửi theo chính sách riêng.',
    ask: 'Hỏi VSual',
    sample: 'Dùng câu hỏi mẫu',
    sampleText:
      'So sánh số đơn hoàn thành ở miền Nam tháng 8 với tháng 7 năm 2026.',
    cancel: 'Hủy yêu cầu',
    answer: 'Câu trả lời',
    evidence: 'Dữ liệu đối chiếu',
    viewEvidence: 'Xem dữ liệu đối chiếu',
    table: 'Bảng nguồn đã chụp',
    viewTable: 'Xem bảng nguồn đã chụp',
    capture: 'Đọc bảng nguồn',
    refresh: 'Đọc lại trang',
    back: 'Quay lại câu trả lời',
    previous:
      'Dữ liệu đã đọc trước đó — trang hoặc thẻ đã thay đổi. Đọc lại trước khi hỏi về trang hiện tại.',
    captured: 'Thời điểm đọc',
    read: 'Đọc câu trả lời',
    stop: 'Dừng giọng đọc',
    repeat: 'Phát / Phát lại',
    speech: 'Bật giọng đọc',
    speechHelp:
      'Tự động đọc câu trả lời mới bằng giọng AI. Tắt để dùng trình đọc màn hình. Cài đặt này không điều khiển NVDA.',
    playAnswer: 'Phát câu trả lời',
    retrySpeech: 'Thử lại giọng đọc',
    playbackBlocked: 'Trình duyệt đã chặn tự phát. Chọn Phát câu trả lời.',
    return: 'Quay lại trang',
    returned: 'Đã quay lại trang nguồn.',
    fallback: 'Không tìm thấy vị trí trỏ trước đó. Đã quay lại tiêu đề trang.',
    returnFailed:
      'Không thể quay lại trang nguồn. Hãy chọn thẻ đơn hàng trong trình duyệt.',
    month: 'Tháng',
    value: 'Số đơn hoàn thành hiển thị',
    row: 'Dòng nguồn',
    region: 'Khu vực',
    year: 'Năm',
    unit: 'Đơn vị: đơn hàng',
    capturedOnly: 'Dựa trên dữ liệu đơn hàng giả lập đã đọc.',
    idle: 'Xem lại câu hỏi trước khi gửi.',
    reading: 'Đang đọc bảng…',
    understanding: 'Đang hiểu câu hỏi…',
    ready: 'Câu trả lời hoặc bảng nguồn đã sẵn sàng.',
    cancelled: 'Đã hủy yêu cầu. Bạn có thể hỏi lại.',
    empty:
      'Câu trả lời sẽ xuất hiện sau khi bạn hỏi. Có thể xem bảng nguồn mà không dùng AI.',
    privacy: 'Chính sách bảo mật Avis (PDF)',
    speechPending:
      'Đang tạo giọng đọc. Dừng giọng đọc sẽ hủy việc chuẩn bị phát.',
  },
} as const;

const errors: Record<string, [string, string]> = {
  AUTH_UNAVAILABLE: [
    'Your session cannot be checked right now. Check your connection and retry. You have not been signed out.',
    'Chưa thể kiểm tra phiên. Kiểm tra kết nối rồi thử lại. Bạn chưa bị đăng xuất.',
  ],
  CONSENT_REQUIRED: [
    'This request was not authorised for processing. Review the question and ask again.',
    'Yêu cầu chưa được cho phép xử lý. Xem lại câu hỏi rồi hỏi lại.',
  ],
  UNSUPPORTED_PAGE: [
    'This page is not supported. Open the configured orders dashboard.',
    'Trang chưa được hỗ trợ. Mở bảng đơn hàng đã cấu hình.',
  ],
  PAGE_UNAVAILABLE: [
    'The supported table is unavailable. Reload the page and extension, then try again.',
    'Không đọc được bảng. Tải lại trang và tiện ích rồi thử lại.',
  ],
  STALE_CONTEXT: [
    'The page changed or could not be rechecked. Capture again; no new AI request was sent automatically.',
    'Trang đã thay đổi hoặc không thể kiểm tra lại. Hãy đọc lại; không tự gửi yêu cầu AI mới.',
  ],
  INVALID_INPUT: [
    'Check your question and the table. Values must be complete, unique whole order counts.',
    'Kiểm tra câu hỏi và bảng. Dữ liệu phải đầy đủ, không trùng lặp và là số nguyên đơn hàng.',
  ],
  INPUT_TOO_LARGE: [
    'The question or captured table is too large. Nothing was sent to AI.',
    'Câu hỏi hoặc bảng quá lớn. Chưa gửi dữ liệu đến AI.',
  ],
  SETUP_REQUIRED: [
    'AI answers or account access are not configured. Ask the project maintainer. You can still inspect the source table.',
    'Chưa cấu hình câu trả lời AI hoặc quyền tài khoản. Hãy liên hệ người quản lý. Bạn vẫn có thể xem bảng nguồn.',
  ],
  UNAUTHENTICATED: ['Sign in again to continue.', 'Đăng nhập lại để tiếp tục.'],
  FORBIDDEN: [
    'Your account or this extension does not have access. Check workspace and allowed-origin setup.',
    'Tài khoản hoặc tiện ích chưa có quyền. Kiểm tra không gian làm việc và nguồn được phép.',
  ],
  APP_RATE_LIMITED: [
    'VSual blocked this answer request because your application usage limit was reached. Your question is preserved. See the usage counts and estimated retry time below.',
    'VSual đã chặn yêu cầu trả lời vì tài khoản đạt giới hạn sử dụng ứng dụng. Câu hỏi vẫn còn. Xem số lượt và thời điểm dự kiến thử lại bên dưới.',
  ],
  PROVIDER_RATE_LIMITED: [
    'The answer provider reached through Avis is limiting requests. Your question is preserved. VSual has no confirmed reset time; retry manually later. Increasing VSual’s own limit does not change the provider’s limit.',
    'Nhà cung cấp trả lời qua Avis đang giới hạn yêu cầu. Câu hỏi vẫn còn. VSual chưa có thời điểm khôi phục xác nhận; hãy tự thử lại sau. Tăng giới hạn VSual không thay đổi giới hạn nhà cung cấp.',
  ],
  RATE_LIMITED: [
    'The request was rate limited, but this backend response did not identify whether VSual or the provider imposed it. Your question is preserved; no reset time is confirmed.',
    'Yêu cầu bị giới hạn nhưng phản hồi máy chủ chưa xác định do VSual hay nhà cung cấp. Câu hỏi vẫn còn; chưa có thời điểm khôi phục xác nhận.',
  ],
  QUOTA_EXHAUSTED: [
    'The answer provider reported a credit or spending limit. Your question and source table are preserved. VSual has no confirmed remaining balance or reset time; ask the maintainer to check the provider account.',
    'Nhà cung cấp trả lời báo giới hạn tín dụng hoặc chi tiêu. Câu hỏi và bảng nguồn vẫn còn. VSual chưa có số dư hoặc thời điểm khôi phục xác nhận; nhờ người quản lý kiểm tra tài khoản nhà cung cấp.',
  ],
  PROVIDER_ACCESS_REQUIRED: [
    'The configured AI model is unavailable to this account. Ask the project maintainer.',
    'Tài khoản không có quyền dùng mô hình AI đã cấu hình. Hãy liên hệ người quản lý.',
  ],
  TIMEOUT: [
    'The request timed out. Review your question and try again when ready.',
    'Yêu cầu quá thời gian. Xem lại câu hỏi và thử lại khi sẵn sàng.',
  ],
  DUPLICATE_REQUEST: [
    'This request was already submitted. Capture again for a new question.',
    'Yêu cầu này đã được gửi. Đọc lại để gửi câu hỏi mới.',
  ],
  DEPLOYMENT_UNAVAILABLE: [
    'The backend returned a deployment or protection page. Check Vercel access separately from app sign-in.',
    'Máy chủ trả về trang triển khai hoặc bảo vệ. Kiểm tra quyền Vercel riêng với đăng nhập ứng dụng.',
  ],
  PROVIDER_FAILURE: [
    'AI could not interpret this request. No answer was invented. You can edit the question or inspect the source table.',
    'AI không thể hiểu yêu cầu. Không tạo câu trả lời giả. Bạn có thể sửa câu hỏi hoặc xem bảng nguồn.',
  ],
};
export function groundedError(language: UiLanguage, code: string) {
  return (errors[code] ?? errors.PROVIDER_FAILURE)![language === 'vi' ? 1 : 0];
}
