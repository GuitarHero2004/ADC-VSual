'use client';

import { useWebsiteLanguage } from './site-shell';

const words = {
  en: {
    title: 'Understand the page. Ask with confidence.',
    intro:
      'Type or speak a question about a supported page, then read the answer and check the evidence behind it.',
    start: 'Get started',
    demo: 'Open demo',
    scopeTitle: 'Start with the orders demo',
    scope:
      'VSual currently supports monthly completed-order comparisons on our synthetic orders dashboard. It does not read other websites or perform website actions.',
  },
  vi: {
    title: 'Hiểu trang đang xem. Tự tin đặt câu hỏi.',
    intro:
      'Nhập hoặc nói câu hỏi về trang được hỗ trợ, rồi đọc câu trả lời và kiểm tra bằng chứng đi kèm.',
    start: 'Bắt đầu',
    demo: 'Mở bản mẫu',
    scopeTitle: 'Bắt đầu với bản mẫu đơn hàng',
    scope:
      'VSual hiện hỗ trợ so sánh số đơn hoàn thành theo tháng trên bảng đơn hàng giả lập. VSual chưa đọc các trang web khác hoặc thao tác trên trang web.',
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
        </div>
      </div>
      <section className="scope-notice" aria-labelledby="scope-heading">
        <h2 id="scope-heading">{copy.scopeTitle}</h2>
        <p>{copy.scope}</p>
      </section>
    </main>
  );
}
