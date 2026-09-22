import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normaliseSpeechText, prepareSpeechInput } from './speech-text.ts';
import { VoiceError } from './errors.ts';

test('explicit currency prices and bounded billing units have English and Vietnamese spoken copies', () => {
  const examples = [
    ['USD55', 'fifty-five US dollars', 'năm mươi lăm đô la Mỹ'],
    ['55 USD', 'fifty-five US dollars', 'năm mươi lăm đô la Mỹ'],
    [
      'USD55/seat/month',
      'fifty-five US dollars per seat per month',
      'năm mươi lăm đô la Mỹ mỗi chỗ mỗi tháng',
    ],
    [
      '55USD / user / yr',
      'fifty-five US dollars per user per year',
      'năm mươi lăm đô la Mỹ mỗi người dùng mỗi năm',
    ],
    ['US$1/month', 'one US dollar per month', 'một đô la Mỹ mỗi tháng'],
    [
      'USD0.05/day',
      'zero point zero five US dollars per day',
      'không phẩy không năm đô la Mỹ mỗi ngày',
    ],
    [
      'USD55,50/month',
      'fifty-five point five zero US dollars per month',
      'năm mươi lăm phẩy năm không đô la Mỹ mỗi tháng',
    ],
    [
      'USD1.00',
      'one point zero zero US dollar',
      'một phẩy không không đô la Mỹ',
    ],
    ['USD1.01', 'one point zero one US dollars', 'một phẩy không một đô la Mỹ'],
    [
      'USD1,234.50',
      'one thousand two hundred thirty-four point five zero US dollars',
      'một nghìn hai trăm ba mươi bốn phẩy năm không đô la Mỹ',
    ],
    [
      'USD1.234,50',
      'one thousand two hundred thirty-four point five zero US dollars',
      'một nghìn hai trăm ba mươi bốn phẩy năm không đô la Mỹ',
    ],
    [
      'VND1250000/người dùng/tháng',
      'one million two hundred fifty thousand Vietnamese dong per user per month',
      'một triệu hai trăm năm mươi nghìn đồng Việt Nam mỗi người dùng mỗi tháng',
    ],
    [
      '1.250.000 VND',
      'one million two hundred fifty thousand Vietnamese dong',
      'một triệu hai trăm năm mươi nghìn đồng Việt Nam',
    ],
    [
      '₫1,250,000',
      'one million two hundred fifty thousand Vietnamese dong',
      'một triệu hai trăm năm mươi nghìn đồng Việt Nam',
    ],
    ['USD0', 'zero US dollars', 'không đô la Mỹ'],
    [
      'usd\u00a055 / Seats / Month',
      'fifty-five US dollars per seat per month',
      'năm mươi lăm đô la Mỹ mỗi chỗ mỗi tháng',
    ],
  ] as const;
  for (const [source, en, vi] of examples) {
    assert.equal(normaliseSpeechText(source, 'en'), en, source);
    assert.equal(normaliseSpeechText(source, 'vi'), vi, source);
  }
});

test('sentences, qualifiers, punctuation and unrelated numbers retain their meaning and spelling', () => {
  const input =
    '  Giá Nguyễn An: USD55/seat/month (chưa thuế), đến 09/10; tăng 12.5%.  ';
  assert.equal(
    normaliseSpeechText(input, 'vi'),
    '  Giá Nguyễn An: năm mươi lăm đô la Mỹ mỗi chỗ mỗi tháng (chưa thuế), đến 09/10; tăng 12.5%.  ',
  );
  assert.equal(
    normaliseSpeechText('(USD55), or USD60.', 'en'),
    '(fifty-five US dollars), or sixty US dollars.',
  );
  assert.equal(
    normaliseSpeechText('USD55/month. USD60/year!', 'en'),
    'fifty-five US dollars per month. sixty US dollars per year!',
  );
  assert.equal(
    normaliseSpeechText('Ngày 09/10, 1.250.000 VND và 12.5%.', 'vi'),
    'Ngày 09/10, một triệu hai trăm năm mươi nghìn đồng Việt Nam và 12.5%.',
  );
});

test('ambiguous or unsupported numbers and currency units remain untouched, without partial matches', () => {
  const examples = [
    '$55/seat/month',
    'AUD55',
    'EUR55',
    'USD1,250',
    'USD1.250',
    'VND55.000',
    'USD01',
    'USD0055.00',
    'USD.55',
    ',55 USD',
    '.55 USD',
    'USD55.555',
    'USD1,23,456',
    'USD1.23.456',
    'USD1,234.567',
    'USD1.234,567',
    'USD1..234',
    'USD1 250',
    '1 250 USD',
    'USD1, 234',
    '1, 234 USD',
    'USD1\u202f250',
    'USD1\u00a0250',
    'USD55\u2009250',
    '1\u2009250USD',
    "USD1'250.00",
    "1'250.00 USD",
    'USD1’250.00',
    '1’250.00 USD',
    'USD55k',
    'USD55e3',
    'USD55ABC',
    'USD55%',
    'USD55/2',
    'USD55/gibberish',
    'USD55/month/year',
    'USD55/monthly',
    'USD55/seat/month/year',
    'USD55/seat/month/other',
    'USD55/users/seat',
    'USD55/year/user',
    'USD55-USD60',
    'USD55–60',
    '-USD55',
    'USD-55',
    'USD−55',
    '+USD55',
    '-55 USD',
    'USD1000000000000',
    '01/02/2026',
    'Q3',
    '12.5%',
    '1e10',
  ];
  for (const source of examples)
    for (const language of ['en', 'vi'] as const)
      assert.equal(
        normaliseSpeechText(source, language),
        source,
        `${language}: ${source}`,
      );
});

test('URLs, email addresses, identifiers, paths and marked code are not rewritten', () => {
  for (const source of [
    'https://example.test/USD55/seat/month?q=VND1250000',
    'www.example.test?q=USD55',
    'reader+USD55@example.test',
    'USD55@example.test',
    'SKU_USD55',
    'fooUSD55',
    'order-USD55',
    'USD55-code',
    'USD55.pdf',
    'C:\\prices\\USD55',
    '/prices/USD55',
    'code=USD55',
    '`USD55/seat/month`',
    '```js\nconst price = "USD55";\n```',
    '~~~\nUSD55\n~~~',
    '`USD55\n',
    '```USD55',
    '<div title="USD55">',
  ])
    assert.equal(normaliseSpeechText(source, 'vi'), source, source);
  assert.equal(
    normaliseSpeechText(
      'See `USD55` or https://example.test/USD55; price USD55.',
      'en',
    ),
    'See `USD55` or https://example.test/USD55; price fifty-five US dollars.',
  );
});

test('preparation is idempotent, does not mutate source data, and never guesses an absent language', () => {
  for (const language of ['en', 'vi'] as const) {
    const input = Object.freeze({ text: 'USD55/seat/month', language });
    const prepared = prepareSpeechInput(input);
    assert.notEqual(prepared.text, input.text);
    assert.equal(input.text, 'USD55/seat/month');
    assert.deepEqual(prepareSpeechInput(prepared), prepared);
  }
  assert.deepEqual(prepareSpeechInput({ text: 'Giá USD55/seat/month' }), {
    text: 'Giá USD55/seat/month',
  });
  for (const value of [
    null,
    {},
    { text: '' },
    { text: 'USD55', language: 'auto' },
    { text: 'USD55', voiceId: 'override' },
  ])
    assert.throws(
      () => prepareSpeechInput(value),
      (error) => error instanceof VoiceError && error.code === 'INVALID_INPUT',
    );
});

test('both original and spoken copies obey the unchanged Unicode limit without truncation', () => {
  const spokenLength = Array.from(normaliseSpeechText('USD55', 'en')).length;
  const original = `${'😀'.repeat(1000 - spokenLength - 1)} USD55`;
  assert.equal(
    Array.from(prepareSpeechInput({ text: original, language: 'en' }).text)
      .length,
    1000,
  );
  assert.throws(
    () => prepareSpeechInput({ text: original + '😀', language: 'en' }),
    (error) =>
      error instanceof VoiceError &&
      error.code === 'INPUT_TOO_LARGE' &&
      !error.message.includes(original),
  );
  assert.throws(
    () => prepareSpeechInput({ text: '😀'.repeat(1001), language: 'vi' }),
    (error) => error instanceof VoiceError && error.code === 'INVALID_INPUT',
  );
});
