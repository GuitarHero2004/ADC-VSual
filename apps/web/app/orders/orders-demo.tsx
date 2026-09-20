'use client';

import { useWebsiteLanguage } from '../site-shell';

const words = {
  en: {
    eyebrow: 'VSual · Synthetic demo data',
    intro:
      'This dashboard contains fictional completed-order counts. Open the VSual extension to compare August and July, then inspect the source values and calculation.',
    source:
      'The source data below stays in English when you change the interface language. Counts are whole completed orders, not currency. Both available monthly rows are shown.',
    table: 'Completed orders table; scroll horizontally if needed',
    try: 'Try the companion',
    steps:
      'Open VSual, sign in and allow page processing when you choose to use this demo. Type or record a question, review it, then select Ask VSual.',
    consent:
      'VSual reads this table only after you allow page processing and ask a question or choose to inspect the source table. Opening this page does not send its contents to AI. VSual does not change this page.',
    setup: 'Setup and optional voice test',
    home: 'Back to VSual',
  },
  vi: {
    eyebrow: 'VSual · Dữ liệu bản mẫu giả lập',
    intro:
      'Bảng này chứa số đơn hoàn thành giả lập. Mở tiện ích VSual để so sánh tháng 8 với tháng 7, rồi kiểm tra giá trị nguồn và phép tính.',
    source:
      'Dữ liệu nguồn bên dưới giữ nguyên tiếng Anh khi đổi ngôn ngữ giao diện. Các số là số đơn hoàn thành nguyên, không phải tiền tệ. Cả hai hàng tháng hiện có đều được hiển thị.',
    table: 'Bảng số đơn hoàn thành; cuộn ngang nếu cần',
    try: 'Dùng thử trợ lý',
    steps:
      'Mở VSual, đăng nhập và cho phép xử lý trang khi bạn muốn sử dụng bản mẫu. Nhập hoặc ghi âm câu hỏi, xem lại rồi chọn Hỏi VSual.',
    consent:
      'VSual chỉ đọc bảng sau khi bạn cho phép xử lý trang và đặt câu hỏi hoặc chọn xem bảng nguồn. Mở trang này không gửi nội dung đến AI. VSual không thay đổi trang.',
    setup: 'Thiết lập và thử giọng nói tùy chọn',
    home: 'Quay lại VSual',
  },
};

export default function OrdersDemo() {
  const { language } = useWebsiteLanguage();
  const copy = words[language];
  return (
    <main id="main-content" data-vsual-orders lang={language} tabIndex={-1}>
      <p className="eyebrow">{copy.eyebrow}</p>
      <h1 lang="en-US">Completed orders</h1>
      <p>{copy.intro}</p>
      <p className="field-help">{copy.source}</p>
      <dl className="orders-context" lang="en-US">
        <div>
          <dt>Region</dt>
          <dd data-orders-region>South</dd>
        </div>
        <div>
          <dt>Year</dt>
          <dd data-orders-year>2026</dd>
        </div>
        <div>
          <dt>Metric</dt>
          <dd data-orders-metric>Completed orders</dd>
        </div>
        <div>
          <dt>Unit</dt>
          <dd data-orders-unit>orders</dd>
        </div>
      </dl>
      <div
        className="table-scroll"
        role="region"
        aria-label={copy.table}
        tabIndex={0}
      >
        <table data-orders-table lang="en-US">
          <caption>Monthly completed orders — South, 2026</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Completed orders</th>
            </tr>
          </thead>
          <tbody>
            <tr data-row-id="2026-07">
              <th scope="row">
                <time dateTime="2026-07">July 2026</time>
              </th>
              <td data-column="completed">1,200</td>
            </tr>
            <tr data-row-id="2026-08">
              <th scope="row">
                <time dateTime="2026-08">August 2026</time>
              </th>
              <td data-column="completed">900</td>
            </tr>
          </tbody>
        </table>
      </div>
      <section aria-labelledby="try-heading">
        <h2 id="try-heading">{copy.try}</h2>
        <p>{copy.steps}</p>
        <p lang="en">
          “Compare completed orders in the South for August and July.”
        </p>
        <p lang="vi">
          “So sánh số đơn hoàn thành ở miền Nam tháng 8 với tháng 7 năm 2026.”
        </p>
        <p>{copy.consent}</p>
        <a className="button-link" href="/voice">
          {copy.setup}
        </a>
      </section>
      <a href="/">{copy.home}</a>
    </main>
  );
}
