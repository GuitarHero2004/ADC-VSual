'use client';

import { useWebsiteLanguage } from './site-shell';

const words = {
  en: {
    title: 'Understand the page. Ask with confidence.',
    intro:
      'Type or speak a question about a supported page, then read the answer and check the evidence behind it.',
    start: 'Get started',
    demo: 'Open demo',
    scopeTitle: 'Supported page reading',
    scope:
      'When you ask, VSual reads headings, paragraphs and lists in supported HTML articles using browser access you have granted. No separate processing-approval step is required. The synthetic orders demo also supports exact monthly completed-order comparisons. Screenshots, whole files and website actions are not supported.',
    article: 'Open article demo',
  },
  vi: {
    title: 'Hiểu trang đang xem. Tự tin đặt câu hỏi.',
    intro:
      'Nhập hoặc nói câu hỏi về trang được hỗ trợ, rồi đọc câu trả lời và kiểm tra bằng chứng đi kèm.',
    start: 'Bắt đầu',
    demo: 'Mở bản mẫu',
    scopeTitle: 'Phạm vi đọc trang được hỗ trợ',
    scope:
      'Khi bạn đặt câu hỏi, VSual đọc tiêu đề, đoạn văn và danh sách trong bài viết HTML phù hợp bằng quyền truy cập trình duyệt bạn đã cấp. Không cần bước cho phép xử lý riêng. Bản mẫu đơn hàng vẫn hỗ trợ so sánh chính xác số đơn hoàn thành theo tháng. Chưa hỗ trợ ảnh chụp, toàn bộ tệp hoặc thao tác trên trang.',
    article: 'Mở bài viết mẫu',
  },
};

export default function HomePage() {
  const { language } = useWebsiteLanguage();
  const copy = words[language];
  return (
    <main id="main-content" tabIndex={-1} lang={language}>
      <div className="home-intro">
        <h1>{copy.title}</h1>
        <p className="intro">{copy.intro}</p>
        <div className="controls">
          <a className="button-link primary" href="/voice">
            {copy.start}
          </a>
          <a className="button-link" href="/orders">
            {copy.demo}
          </a>
          <a className="button-link" href="/reading-demo">
            {copy.article}
          </a>
        </div>
      </div>
      <section className="scope-notice" aria-labelledby="scope-heading">
        <h2 id="scope-heading">{copy.scopeTitle}</h2>
        <p>{copy.scope}</p>
      </section>
    </main>
  );
}
