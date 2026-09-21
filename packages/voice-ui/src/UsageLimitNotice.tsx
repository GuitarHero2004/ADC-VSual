'use client';

import { useId } from 'react';
import type { UiLanguage, UsageLimit } from '@adc/contracts';

interface Props {
  usage: UsageLimit;
  language: UiLanguage;
  operation: 'transcribe' | 'answer' | 'speak';
}

/** Server-supplied application usage only; never provider credit estimates. */
export function UsageLimitNotice({ usage, language, operation }: Props) {
  const headingId = useId();
  const vi = language === 'vi';
  const operationName = {
    transcribe: vi ? 'Chép lời' : 'Transcription',
    answer: vi ? 'Câu trả lời' : 'Answer',
    speak: vi ? 'Giọng đọc' : 'Read-back',
  }[operation];
  const date = new Intl.DateTimeFormat(vi ? 'vi-VN' : 'en', {
    dateStyle: 'medium',
    timeStyle: 'long',
  }).format(new Date(usage.retry_at));
  const windowName =
    usage.limited_by === 'both'
      ? vi
        ? 'cả hai khoảng thời gian'
        : 'both windows'
      : usage.limited_by === 'minute'
        ? vi
          ? '60 giây qua'
          : 'the last 60 seconds'
        : vi
          ? '24 giờ qua'
          : 'the last 24 hours';
  return (
    <section
      className="usage-limit-notice"
      aria-labelledby={headingId}
      lang={language}
    >
      <h3 id={headingId}>
        {operationName}: {vi ? 'giới hạn yêu cầu VSual' : 'VSual request limit'}
      </h3>
      <ul>
        <li>
          {vi ? '60 giây qua' : 'Last 60 seconds'}: {usage.minute_count} /{' '}
          {usage.minute_limit} {vi ? 'yêu cầu' : 'requests'}.
        </li>
        <li>
          {vi ? '24 giờ qua' : 'Last 24 hours'}: {usage.day_count} /{' '}
          {usage.day_limit} {vi ? 'yêu cầu' : 'requests'}.
        </li>
        <li>
          {vi ? 'Đã đạt giới hạn' : 'Limit reached for'}: {windowName}.
        </li>
      </ul>
      <p>
        {vi
          ? 'Số liệu được ghi nhận khi yêu cầu này bị chặn, không phải bộ đếm trực tiếp.'
          : 'Usage recorded when this request was blocked; these are not live counters.'}
      </p>
      <p>
        {vi ? 'Ước tính có thể thử lại từ: ' : 'Estimated retry from: '}
        <time dateTime={usage.retry_at}>{date}</time>.{' '}
        {vi
          ? 'Hãy tự chọn thử lại; mốc này không đảm bảo còn lượt.'
          : 'Retry manually; this time does not guarantee availability.'}
      </p>
      <details>
        <summary>{vi ? 'Cách tính giới hạn' : 'How this limit works'}</summary>
        <ul>
          <li>
            {vi
              ? 'Giới hạn dùng chung cho tài khoản trên web, tiện ích và mọi không gian làm việc: chép lời, câu trả lời và giọng đọc.'
              : 'One account shares this limit across the website, extension and workspaces: transcription, answers and speech.'}
          </li>
          <li>
            {vi
              ? 'Tính trong 60 giây và 24 giờ gần nhất; không đặt lại lúc nửa đêm hay khi đăng xuất.'
              : 'These are rolling 60-second and 24-hour windows; midnight and sign-out do not reset them.'}
          </li>
          <li>
            {vi
              ? 'Một lượt hỏi bằng giọng nói có thể dùng 3 yêu cầu. Lỗi sau khi giữ lượt vẫn được tính. Phát lại âm thanh đã tạo không dùng thêm lượt.'
              : 'A complete spoken question can use 3 requests. Failures after a slot is reserved still count. Replaying cached audio uses no extra request.'}
          </li>
          <li>
            {vi
              ? 'Yêu cầu bị chặn này chưa được gửi tới nhà cung cấp. Hạn mức của nhà cung cấp là riêng biệt và không được hiển thị ở đây.'
              : 'This blocked request was not sent to the provider. Provider credits are separate and are not shown here.'}
          </li>
        </ul>
      </details>
    </section>
  );
}
