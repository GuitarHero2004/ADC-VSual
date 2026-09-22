import type { UiLanguage } from '@adc/contracts';

export const visualText = {
  en: {
    ready:
      'Page images are available after browser activation. Answers describe captured content, not the complete file or account.',
    access:
      'Use VSual’s browser toolbar button or assigned shortcut on this tab to enable access, then ask again. Your draft is preserved. If this browser view prevents privacy masking, it cannot be read yet.',
    processingNotice:
      'When you ask, VSual automatically captures this view and sends the image and question through Avis. Opening VSual alone captures nothing.',
    noticeTitle: 'How page images are processed',
    notice:
      'Page images are sent through Avis to the configured model service. They may include private information and visible unsaved document content. Known private controls and VSual are excluded where supported; this is not universal removal of private information. Reading an eligible longer page may temporarily scroll it. You can cancel. Our app does not save screenshots; provider retention follows its own policies.',
    capturing: 'Capturing page images…',
    cancel: 'Cancel capture',
    requestDetails: 'Request details',
    requestReference: 'Request reference',
    source: 'Visual source',
    evidence: 'Visual supporting evidence',
    interpretation:
      'Visual interpretation; readable descriptions are provided below. References identify image regions, not independently verified facts.',
    current:
      'Based on one captured browser view. Content outside this view and the rest of the file were not read.',
    rendered:
      'Based on a sequence of captured page regions taken at different moments. This does not establish complete file or website coverage.',
    areaComplete:
      'The measured scroll area was covered. Excluded or occluded regions may still be missing.',
    areaPartial: 'Only part of the measured page area was captured.',
    omissions: 'Coverage limitations',
    readCurrent: 'Read current view',
    readFirst: 'Read first portion',
    narrowing:
      'The requested page does not fit the supported capture scope. Nothing was sent to the model. Choose a smaller scope or edit your question.',
    caption: 'Image',
    captured: 'Captured',
    sample:
      'Explain the main information in this view and identify anything unclear.',
  },
  vi: {
    ready:
      'Có thể dùng ảnh trang sau khi kích hoạt từ trình duyệt. Câu trả lời dựa trên nội dung đã chụp, không phải toàn bộ tệp hoặc tài khoản.',
    access:
      'Dùng nút VSual trên thanh công cụ hoặc phím tắt tại thẻ này để cấp quyền, rồi hỏi lại. Bản nháp được giữ nguyên. Nếu trình duyệt chặn việc che vùng riêng tư, VSual chưa thể đọc vùng này.',
    processingNotice:
      'Khi bạn hỏi, VSual tự động chụp vùng này và gửi ảnh cùng câu hỏi qua Avis. Chỉ mở VSual không chụp nội dung.',
    noticeTitle: 'Cách xử lý ảnh trang',
    notice:
      'Ảnh trang được gửi qua Avis đến dịch vụ mô hình đã cấu hình. Ảnh có thể chứa thông tin riêng tư và nội dung tài liệu chưa lưu. Các trường riêng tư đã nhận diện và VSual được loại trừ khi hỗ trợ; không bảo đảm loại bỏ mọi thông tin riêng tư. Đọc trang dài phù hợp có thể tạm cuộn trang. Bạn có thể hủy. Ứng dụng không lưu ảnh; nhà cung cấp áp dụng chính sách lưu giữ riêng.',
    capturing: 'Đang chụp nội dung trang…',
    cancel: 'Hủy chụp',
    requestDetails: 'Chi tiết yêu cầu',
    requestReference: 'Mã tham chiếu yêu cầu',
    source: 'Nguồn hình ảnh',
    evidence: 'Bằng chứng hình ảnh có mô tả',
    interpretation:
      'Diễn giải từ hình ảnh; có mô tả đọc được bên dưới. Tham chiếu xác định vùng ảnh, không bảo đảm nội dung đã được xác minh độc lập.',
    current:
      'Dựa trên một vùng trình duyệt đã chụp. Chưa đọc nội dung ngoài vùng này hoặc phần còn lại của tệp.',
    rendered:
      'Dựa trên các vùng trang được chụp ở những thời điểm khác nhau. Không chứng minh đã đọc toàn bộ tệp hoặc website.',
    areaComplete:
      'Đã chụp phạm vi cuộn đo được. Một số vùng bị loại trừ hoặc che khuất vẫn có thể thiếu.',
    areaPartial: 'Chỉ chụp một phần phạm vi trang đo được.',
    omissions: 'Giới hạn phạm vi',
    readCurrent: 'Đọc vùng đang hiển thị',
    readFirst: 'Đọc phần đầu',
    narrowing:
      'Trang yêu cầu vượt phạm vi chụp được hỗ trợ. Chưa gửi gì đến mô hình. Chọn phạm vi nhỏ hơn hoặc sửa câu hỏi.',
    caption: 'Ảnh',
    captured: 'Thời điểm chụp',
    sample:
      'Giải thích thông tin chính trong vùng này và nêu nội dung chưa rõ.',
  },
} as const;

const errors: Record<string, [string, string]> = {
  SETUP_REQUIRED: [
    'Visual reading is not enabled on this backend. Its configured model route must first pass the synthetic image check. Structured text and orders reading remain available.',
    'Máy chủ chưa bật đọc hình ảnh. Tuyến mô hình đã cấu hình cần vượt qua kiểm tra ảnh thử nghiệm trước. Vẫn có thể đọc văn bản có cấu trúc và bảng đơn hàng.',
  ],
  PAGE_PERMISSION_REQUIRED: [visualText.en.access, visualText.vi.access],
  VISUAL_SCOPE_TOO_LARGE: [visualText.en.narrowing, visualText.vi.narrowing],
  VISUAL_UNSUPPORTED: [
    'This view cannot be captured safely with the available access. Try the browser side panel or another supported view.',
    'Chưa thể chụp an toàn vùng này bằng quyền hiện có. Thử bảng bên trình duyệt hoặc vùng khác được hỗ trợ.',
  ],
  VISUAL_PRIVACY_UNAVAILABLE: [
    'Private regions cannot be excluded reliably in this view. Your question is preserved; use a supported view.',
    'Chưa loại trừ chắc chắn được vùng riêng tư ở đây. Câu hỏi được giữ lại; hãy dùng vùng được hỗ trợ.',
  ],
  VISUAL_UNSTABLE: [
    'The page changed while capturing. Your question is preserved; ask about the current view instead.',
    'Trang thay đổi khi chụp. Câu hỏi được giữ lại; hãy hỏi về vùng đang hiển thị.',
  ],
  VISUAL_USER_TAKEOVER: [
    'Capture stopped because you interacted with the page. Your position and question are preserved.',
    'Đã dừng chụp vì bạn thao tác trên trang. Giữ nguyên vị trí và câu hỏi của bạn.',
  ],
  VISUAL_BUSY: [
    'Another capture is active. Cancel it or wait, then ask again.',
    'Đang có một tác vụ chụp khác. Hủy hoặc chờ tác vụ đó rồi hỏi lại.',
  ],
};

export function visualError(language: UiLanguage, code: string): string | null {
  const error = errors[code];
  return error ? error[language === 'vi' ? 1 : 0] : null;
}

const limits: Record<string, [string, string]> = {
  current_view_only: [
    'Only the captured viewport was read.',
    'Chỉ đọc vùng hiển thị đã chụp.',
  ],
  first_portion_only: [
    'Only the first bounded portion was captured; the remainder was not read.',
    'Chỉ chụp phần đầu trong giới hạn; chưa đọc phần còn lại.',
  ],
  redacted_regions: [
    'Private controls or VSual regions were excluded.',
    'Đã loại trừ trường riêng tư hoặc vùng VSual.',
  ],
  occluded_regions: [
    'Some content was covered by overlays.',
    'Một số nội dung bị lớp phủ che.',
  ],
  frames: [
    'Uninspectable embedded frames were excluded.',
    'Đã loại trừ khung nhúng không kiểm tra được.',
  ],
  nested_scrollers: [
    'Content outside nested visible scrolling regions was not traversed.',
    'Không cuộn qua nội dung ngoài vùng cuộn lồng đang hiển thị.',
  ],
  horizontal_overflow: [
    'Content outside the horizontal view was omitted.',
    'Bỏ qua nội dung ngoài chiều ngang hiển thị.',
  ],
  unloaded_content: [
    'Unloaded or virtualised content may be missing.',
    'Có thể thiếu nội dung chưa tải hoặc chỉ dựng khi hiển thị.',
  ],
  collapsed_content: [
    'Collapsed content was not opened or read.',
    'Không mở hoặc đọc nội dung đang thu gọn.',
  ],
  sequential_captures: [
    'Images were captured at different moments.',
    'Các ảnh được chụp ở những thời điểm khác nhau.',
  ],
  dynamic_content: [
    'Changing content is represented only at capture time.',
    'Nội dung thay đổi chỉ được thể hiện tại thời điểm chụp.',
  ],
  geometry_only: [
    'Scroll-area coverage does not prove that all document content was read.',
    'Phạm vi cuộn đã chụp không chứng minh đã đọc toàn bộ nội dung tài liệu.',
  ],
  document_not_retrieved: [
    'The original file or complete document was not retrieved.',
    'Không truy xuất tệp gốc hoặc toàn bộ tài liệu.',
  ],
  masking_unavailable: [
    'Some regions could not be inspected for masking.',
    'Không thể kiểm tra một số vùng để che nội dung riêng tư.',
  ],
};
export function visualLimitation(language: UiLanguage, code: string) {
  return (
    limits[code]?.[language === 'vi' ? 1 : 0] ??
    (language === 'vi'
      ? 'Một số nội dung ngoài phạm vi đã chụp hoặc chưa thể xác nhận.'
      : 'Some content is outside captured coverage or could not be established.')
  );
}
