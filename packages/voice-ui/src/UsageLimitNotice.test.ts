import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import type { UsageLimit } from '@adc/contracts';
import { questionNoticeText } from './strings.ts';

test('application usage details localise server counts and estimated time without live counters or automatic retry', async (t) => {
  const hook = registerHooks({
    load(url, context, next) {
      if (!url.endsWith('.tsx')) return next(url, context);
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText,
      };
    },
  });
  t.after(() => hook.deregister());
  t.mock.method(globalThis, 'fetch', () => {
    assert.fail('Usage details must not fetch or retry requests');
  });
  const { UsageLimitNotice } = await import('./UsageLimitNotice.tsx');
  const usage: UsageLimit = {
    minute_count: 24,
    minute_limit: 24,
    day_count: 73,
    day_limit: 240,
    limited_by: 'minute',
    retry_after_seconds: 42,
    retry_at: '2000-01-01T00:00:00.000Z',
  };
  for (const language of ['en', 'vi'] as const) {
    for (const operation of ['transcribe', 'answer', 'speak'] as const) {
      const dom = new JSDOM(
        renderToStaticMarkup(
          createElement(UsageLimitNotice, { usage, language, operation }),
        ),
      );
      const section = dom.window.document.querySelector('section')!;
      const content = section.textContent!;
      assert.match(content, /24 \/ 24/);
      assert.match(content, /73 \/ 240/);
      assert.equal(section.lang, language);
      assert.ok(
        dom.window.document.getElementById(
          section.getAttribute('aria-labelledby')!,
        )?.textContent,
      );
      assert.equal(
        section.closest('[role=status], [role=alert], [aria-live]'),
        null,
      );
      const time = section.querySelector('time')!;
      assert.equal(time.dateTime, usage.retry_at);
      assert.equal(
        time.textContent,
        new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en', {
          dateStyle: 'medium',
          timeStyle: 'long',
        }).format(new Date(usage.retry_at)),
      );
      assert.equal(
        section.querySelector('button'),
        null,
        'Passing the estimated retry time does not submit anything or claim a reset',
      );
      assert.match(
        content,
        language === 'en' ? /not live counters/ : /không phải bộ đếm trực tiếp/,
      );
      assert.match(
        content,
        language === 'en'
          ? /does not guarantee availability/
          : /không đảm bảo còn lượt/,
      );
      assert.match(
        content,
        language === 'en'
          ? /midnight and sign-out do not reset/
          : /không đặt lại lúc nửa đêm hay khi đăng xuất/,
      );
      assert.match(
        content,
        language === 'en' ? /can use 3 requests/ : /có thể dùng 3 yêu cầu/,
      );
      assert.match(
        content,
        language === 'en'
          ? /Provider credits are separate/
          : /Hạn mức của nhà cung cấp là riêng biệt/,
      );
      assert.equal(section.querySelector('details')?.open, false);
      dom.window.close();
    }
  }
});

test('manual and duration-limited question recordings clearly require review and Ask', () => {
  assert.match(
    questionNoticeText('en', 'duration_reached'),
    /review; choose Ask VSual/,
  );
  assert.match(
    questionNoticeText('vi', 'duration_reached'),
    /xem lại; chọn Hỏi VSual/,
  );
  assert.match(
    questionNoticeText('en', 'silence_unavailable'),
    /Stop and review/,
  );
  assert.match(
    questionNoticeText('vi', 'silence_unavailable'),
    /Dừng và xem lại/,
  );
});
