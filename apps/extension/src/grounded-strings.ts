import type { UiLanguage } from '@adc/contracts';

export const groundedText = {
  en: {
    page: 'Current page',
    supported: 'Supported orders dashboard',
    unsupported:
      'Open the configured /orders demo page to compare completed orders. Other pages are not supported.',
    checking: 'Checking the active tab…',
    scope:
      'Compare completed-order counts for one region and two months. VSual does not change the page.',
    permission: 'Page processing permission',
    permissionHelp:
      'Page permission is unavailable on this tab. Open one of these supported dashboard pages:',
    recheck: 'Check active page',
    recheckHelp:
      'Keep the dashboard tab selected, then choose Check active page. This checks the page address only; it does not read or send page content.',
    notice:
      'Allow VSual to read the displayed orders table and its region/year context on this origin. When you ask, our backend processes the question and captured rows. Only your question and necessary scope context go through Avis to the configured model provider; our application calculates from the row counts. We save no page content or answers in our database. Inspecting the table alone makes no AI request. Avis and the model provider may retain submitted data under their own policies.',
    allow: 'Allow page processing',
    deny: 'Cancel / withdraw permission',
    allowed: 'Page processing allowed for this signed-in session and origin.',
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
    speech: 'Enable app speech',
    speechHelp:
      'Off by default. Your screen reader can read the full answer and evidence. Speech generation is optional and AI-generated.',
    speed: 'Playback speed',
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
    capturedOnly:
      'This answer describes captured synthetic page data, not independently verified business records.',
    idle: 'Ready. Review your question before asking.',
    reading: 'Reading the dashboard…',
    understanding: 'Understanding your question…',
    ready: 'Answer or source table ready.',
    cancelled: 'Request cancelled. You can ask again.',
    empty:
      'Your answer will appear here after you ask. You can inspect the source table without AI.',
    privacy: 'Avis privacy policy (PDF)',
    speechPending:
      'Speech is being prepared. Stop speech cancels playback preparation.',
  },
  vi: {
    page: 'Trang hiện tại',
    supported: 'Bảng đơn hàng được hỗ trợ',
    unsupported:
      'Mở trang /orders đã cấu hình để so sánh số đơn hoàn thành. Chưa hỗ trợ các trang khác.',
    checking: 'Đang kiểm tra thẻ đang mở…',
    scope:
      'So sánh số đơn hoàn thành của một khu vực trong hai tháng. VSual không thay đổi trang.',
    permission: 'Quyền xử lý nội dung trang',
    permissionHelp:
      'Chưa thể cho phép xử lý trên thẻ này. Mở một trong các trang bảng đơn hàng được hỗ trợ:',
    recheck: 'Kiểm tra thẻ đang mở',
    recheckHelp:
      'Chọn thẻ bảng đơn hàng, rồi chọn Kiểm tra thẻ đang mở. Thao tác này chỉ kiểm tra địa chỉ, không đọc hay gửi nội dung trang.',
    notice:
      'Cho phép VSual đọc bảng đơn hàng và ngữ cảnh khu vực/năm đang hiển thị trên nguồn này. Khi bạn hỏi, máy chủ xử lý câu hỏi và các dòng đã đọc. Chỉ câu hỏi và phạm vi cần thiết đi qua Avis đến nhà cung cấp mô hình đã cấu hình; ứng dụng tự tính từ số đơn. Chúng tôi không lưu nội dung trang hoặc câu trả lời vào cơ sở dữ liệu của ứng dụng. Chỉ xem bảng nguồn không gọi AI. Avis và nhà cung cấp mô hình có thể lưu dữ liệu đã gửi theo chính sách riêng.',
    allow: 'Cho phép xử lý trang',
    deny: 'Hủy / thu hồi quyền',
    allowed: 'Đã cho phép xử lý trang cho phiên đăng nhập và nguồn này.',
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
    speech: 'Bật giọng đọc ứng dụng',
    speechHelp:
      'Mặc định tắt. Trình đọc màn hình có thể đọc đầy đủ câu trả lời và dữ liệu. Giọng đọc AI là tùy chọn.',
    speed: 'Tốc độ phát',
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
    capturedOnly:
      'Câu trả lời mô tả dữ liệu mẫu đã đọc trên trang, không phải hồ sơ kinh doanh được xác minh độc lập.',
    idle: 'Sẵn sàng. Xem lại câu hỏi trước khi gửi.',
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
  CONSENT_REQUIRED: [
    'Allow page processing before capturing this page.',
    'Cho phép xử lý trang trước khi đọc.',
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
  RATE_LIMITED: [
    'The request limit was reached. Your question is preserved; try later.',
    'Đã đạt giới hạn yêu cầu. Câu hỏi vẫn được giữ; hãy thử sau.',
  ],
  QUOTA_EXHAUSTED: [
    'Provider quota is unavailable. Your question and source table are preserved.',
    'Hết hạn mức nhà cung cấp. Câu hỏi và bảng nguồn vẫn được giữ.',
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
