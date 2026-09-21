import type { UiLanguage } from '@adc/contracts';
import { groundedError, groundedText } from './grounded-strings.ts';

export const structuredText = {
  en: {
    activation:
      'Page access is not ready. Select Check active page to reuse access already allowed by your browser. If access is still needed, select VSual’s button in the browser toolbar on this tab. The status updates automatically; your draft is not sent.',
    unsupported:
      'This page has no single supported article or main-content region. VSual can read headings, paragraphs and lists in supported HTML pages.',
    unsupportedHelp:
      'This reader supports headings, paragraphs and lists in a clearly identified HTML article or main region. Granting permission does not add support for a different page format.',
    draftOnly:
      'You can still type or record a draft. VSual cannot answer from this page yet.',
    askUnsupported:
      'Ask VSual is unavailable because this page cannot be read by the current reader.',
    askAccess:
      'Ask VSual is unavailable until browser access and supported page structure are confirmed.',
    docsUnsupported: 'Google Docs document reading is not supported yet.',
    sheetsUnsupported:
      'Google Sheets spreadsheet reading is not supported yet.',
    slidesUnsupported:
      'Google Slides presentation reading is not supported yet.',
    gmailUnsupported: 'Gmail message reading is not supported yet.',
    pdfUnsupported:
      'This address appears to be a PDF. PDF reading is not supported yet.',
    section: 'Section to ask about (optional)',
    allSections: 'Captured page content',
    sectionHelp:
      'Choose a section for “Explain this section”, or name its heading in your question. Scrolling does not select a section.',
    source: 'Captured article content',
    evidence: 'Supporting excerpts',
    coverage: 'Capture coverage',
    partial:
      'Partial coverage. Some content was excluded or exceeded the supported limit.',
    scope:
      'Only supported headings, paragraphs and lists in the selected main region were captured. This may include text below the viewport. It is not a screenshot or a complete website or file.',
    included: 'Included sections',
    omissions: 'Not captured or not supported',
    text_budget:
      'A text, heading, section or block limit was reached; some content or metadata was shortened or omitted.',
    tables: 'Tables and their calculations.',
    frames: 'Embedded frames and their contents.',
    canvas: 'Canvas content.',
    diagrams: 'Images, charts and diagrams.',
    collapsed_content: 'Hidden or collapsed content.',
    pagination: 'Other pages of paginated content.',
    unloaded_content: 'Content that has not loaded.',
  },
  vi: {
    activation:
      'Chưa sẵn sàng truy cập trang. Chọn Kiểm tra trang hiện tại để dùng quyền trình duyệt đã cấp. Nếu vẫn cần quyền, chọn nút VSual trên thanh công cụ trình duyệt tại thẻ này. Trạng thái tự cập nhật; bản nháp không tự gửi.',
    unsupported:
      'Không xác định được một vùng bài viết hoặc nội dung chính phù hợp. VSual hỗ trợ tiêu đề, đoạn văn và danh sách trên trang HTML có cấu trúc.',
    unsupportedHelp:
      'Trình đọc hiện hỗ trợ tiêu đề, đoạn văn và danh sách trong một vùng bài viết hoặc nội dung chính HTML rõ ràng. Cấp quyền không bổ sung khả năng đọc định dạng trang khác.',
    draftOnly:
      'Bạn vẫn có thể nhập hoặc ghi âm bản nháp. VSual chưa thể trả lời từ nội dung trang này.',
    askUnsupported:
      'Chưa thể dùng Hỏi VSual vì trình đọc hiện tại không đọc được trang này.',
    askAccess:
      'Chỉ có thể dùng Hỏi VSual sau khi xác nhận quyền trình duyệt và cấu trúc trang phù hợp.',
    docsUnsupported: 'Chưa hỗ trợ đọc tài liệu Google Docs.',
    sheetsUnsupported: 'Chưa hỗ trợ đọc bảng tính Google Sheets.',
    slidesUnsupported: 'Chưa hỗ trợ đọc bản trình chiếu Google Slides.',
    gmailUnsupported: 'Chưa hỗ trợ đọc thư Gmail.',
    pdfUnsupported: 'Địa chỉ này có vẻ là tệp PDF. Chưa hỗ trợ đọc PDF.',
    section: 'Phần muốn hỏi (tùy chọn)',
    allSections: 'Nội dung trang đã đọc',
    sectionHelp:
      'Chọn phần để “Giải thích phần này”, hoặc nêu tên tiêu đề trong câu hỏi. Cuộn trang không chọn phần cần hỏi.',
    source: 'Nội dung bài viết đã đọc',
    evidence: 'Đoạn trích đối chiếu',
    coverage: 'Phạm vi đã đọc',
    partial:
      'Chỉ đọc được một phần. Một số nội dung bị loại trừ hoặc vượt giới hạn hỗ trợ.',
    scope:
      'Chỉ đọc tiêu đề, đoạn văn và danh sách phù hợp trong vùng nội dung chính. Có thể gồm nội dung bên dưới vùng đang hiển thị. Đây không phải ảnh chụp hay toàn bộ website hoặc tệp.',
    included: 'Các phần được đọc',
    omissions: 'Nội dung không đọc hoặc chưa hỗ trợ',
    text_budget:
      'Đạt giới hạn văn bản, tiêu đề, phần hoặc khối; một số nội dung hoặc siêu dữ liệu bị rút ngắn hoặc bỏ qua.',
    tables: 'Bảng và các phép tính từ bảng.',
    frames: 'Khung nhúng và nội dung bên trong.',
    canvas: 'Nội dung canvas.',
    diagrams: 'Hình ảnh, biểu đồ và sơ đồ.',
    collapsed_content: 'Nội dung ẩn hoặc đang thu gọn.',
    pagination: 'Các trang khác của nội dung phân trang.',
    unloaded_content: 'Nội dung chưa tải.',
  },
} as const;

/** Explain known unsupported surfaces using URL metadata only, never page contents. */
export function unsupportedPageText(
  language: UiLanguage,
  context: { origin: string | null; pathname: string | null } | null,
): string {
  const t = structuredText[language];
  if (!context?.origin) return t.unsupported;
  try {
    const url = new URL(context.origin);
    const pathname = context.pathname ?? '';
    if (url.hostname === 'docs.google.com') {
      if (pathname.startsWith('/document/')) return t.docsUnsupported;
      if (pathname.startsWith('/spreadsheets/')) return t.sheetsUnsupported;
      if (pathname.startsWith('/presentation/')) return t.slidesUnsupported;
    }
    if (url.hostname === 'mail.google.com') return t.gmailUnsupported;
    if (/\.pdf$/iu.test(pathname)) return t.pdfUnsupported;
  } catch {
    // A failed metadata parse must not claim a particular document integration.
  }
  return t.unsupported;
}

export function companionText(language: UiLanguage, structured: boolean) {
  const base = groundedText[language];
  if (!structured) return base;
  return {
    ...base,
    ...(language === 'vi'
      ? {
          readyPage:
            'Trang có cấu trúc được hỗ trợ. Khi bạn chọn Hỏi VSual hoặc câu hỏi ghi âm tự gửi sau khoảng lặng, nội dung trang được đọc tự động. Không cần đọc nguồn riêng.',
          processingNotice:
            'Khi bạn hỏi, câu hỏi và văn bản chính đã đọc được gửi qua Avis đến dịch vụ mô hình đã cấu hình. Chỉ mở trang không gửi nội dung.',
          notice:
            'VSual đọc tiêu đề, đoạn văn và danh sách trong một vùng nội dung chính. Không đọc biểu mẫu, giá trị nhập, vùng chỉnh sửa hoặc giao diện VSual. Văn bản hiển thị vẫn có thể chứa thông tin riêng tư; các loại trừ này không bảo đảm đã loại bỏ mọi dữ liệu riêng tư. Câu hỏi và nội dung đã đọc được gửi qua Avis đến nhà cung cấp mô hình. Ứng dụng không lưu nội dung hoặc câu trả lời vào cơ sở dữ liệu. Xem nguồn không gọi AI. Việc lưu giữ dữ liệu phía Avis và nhà cung cấp tuân theo chính sách riêng; chưa xác nhận chế độ không lưu giữ.',
          inspect: 'Xem nguồn (tùy chọn, không dùng AI)',
          capture: 'Đọc nội dung nguồn',
          tableReady: 'Nội dung nguồn đã sẵn sàng.',
          reading: 'Đang đọc nội dung bài viết…',
          sampleText: 'Tóm tắt nội dung trang đã đọc và nêu những điểm chính.',
          empty:
            'Bạn có thể hỏi ngay; nội dung trang được đọc khi gửi câu hỏi. Hoặc đọc nguồn tại đây để xem phạm vi, các phần và đoạn trích mà không gọi AI.',
          voiceHeldPage:
            'Chưa gửi câu hỏi vì quyền trình duyệt hoặc cấu trúc trang chưa được xác nhận. Kích hoạt VSual từ thanh công cụ, kiểm tra trang, rồi chọn Hỏi VSual.',
          returnFailed:
            'Không thể quay lại trang nguồn. Chọn thẻ nguồn bằng trình duyệt.',
        }
      : {
          readyPage:
            'Supported article structure. Asking captures the page automatically, including when a recorded question submits after the silence countdown. No separate capture step is needed.',
          processingNotice:
            'When you ask, your question and captured main-content text go through Avis to the configured model service. Visiting a page does not send its content.',
          notice:
            'VSual reads headings, paragraphs and lists inside one main-content region. Forms, input values, editable regions and VSual’s interface are excluded. Rendered text may still contain private information; these exclusions do not guarantee its removal. Your question and captured content go through Avis to the configured model provider. Our application does not save content or answers in its database. Inspecting the source alone makes no AI request. Avis and the model provider have their own retention policies; provider-side zero retention has not been established.',
          inspect: 'Inspect source (optional, no AI)',
          capture: 'Capture page content',
          tableReady: 'Source content ready.',
          reading: 'Reading article content…',
          sampleText:
            'Summarise the captured page content and identify its main points.',
          empty:
            'You can ask directly; the page is captured when you submit. Or capture here to inspect coverage, sections and excerpts without calling AI.',
          voiceHeldPage:
            'The question was not sent because browser access or supported page structure could not be confirmed. Activate VSual from the browser toolbar, check the page, then select Ask VSual.',
          returnFailed:
            'Could not return to the source page. Select its tab using the browser.',
        }),
  };
}

export function companionError(
  language: UiLanguage,
  code: string,
  structured: boolean,
) {
  if (!structured) return groundedError(language, code);
  const errors: Record<string, [string, string]> = {
    PAGE_PERMISSION_REQUIRED: [
      structuredText.en.activation,
      structuredText.vi.activation,
    ],
    UNSUPPORTED_PAGE: [
      structuredText.en.unsupported,
      structuredText.vi.unsupported,
    ],
    INVALID_INPUT: [
      'The question or capture could not be validated. Check the page and capture again.',
      'Chưa xác thực được câu hỏi hoặc nội dung. Kiểm tra trang rồi đọc lại.',
    ],
    INPUT_TOO_LARGE: [
      'This request exceeds the text, request-size or model-input budget. Inspect the source, choose a shorter section and ask again. No additional model call was started automatically.',
      'Yêu cầu vượt giới hạn văn bản, kích thước hoặc đầu vào mô hình. Xem nguồn, chọn phần ngắn hơn rồi hỏi lại. Không tự gọi thêm mô hình.',
    ],
    PAGE_UNAVAILABLE: [
      'The source could not be checked. Activate VSual from the browser toolbar on the source tab, then check again.',
      'Chưa kiểm tra được nguồn. Kích hoạt VSual từ thanh công cụ trình duyệt tại thẻ nguồn rồi kiểm tra lại.',
    ],
    SETUP_REQUIRED: [
      'Article answers are not configured for the current model or account. Ask the project maintainer. Source inspection is still available.',
      'Chưa cấu hình trả lời bài viết cho mô hình hoặc tài khoản hiện tại. Liên hệ người quản lý. Bạn vẫn có thể xem nội dung nguồn.',
    ],
  };
  return (
    errors[code]?.[language === 'vi' ? 1 : 0] ?? groundedError(language, code)
  );
}
