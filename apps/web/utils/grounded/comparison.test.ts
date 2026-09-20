import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  comparisonInterpretationSchema,
  fingerprintSnapshot,
  groundedRequestSchema,
  groundedSnapshotSchema,
  parseDisplayedCount,
  type ComparisonInterpretation,
  type GroundedRequest,
  type GroundedSnapshot,
} from '@adc/contracts';
import { calculateComparison } from './comparison.ts';

function snapshot(july = 1200, august = 900): GroundedSnapshot {
  return {
    snapshot_id: '11111111-1111-4111-8111-111111111111',
    adapter_key: 'orders-fixture@1',
    captured_at: '2026-09-20T06:00:00.000Z',
    origin: 'https://dashboard.example.test',
    pathname: '/orders',
    document_key: '22222222-2222-4222-8222-222222222222',
    title: 'Orders dashboard',
    table_title: 'Completed orders by month',
    region: 'South',
    year: 2026,
    metric: 'completed_orders',
    unit: 'orders',
    locale: 'en-US',
    is_complete: true,
    rows: [
      {
        id: '2026-07',
        period: '2026-07',
        region: 'South',
        raw_value: july.toLocaleString('en-US'),
        value: july,
      },
      {
        id: '2026-08',
        period: '2026-08',
        region: 'South',
        raw_value: august.toLocaleString('en-US'),
        value: august,
      },
    ],
    fingerprint: '0'.repeat(64),
  };
}
function request(source = snapshot()): GroundedRequest {
  return {
    request_id: '33333333-3333-4333-8333-333333333333',
    question: 'Compare completed orders in the South for August and July.',
    language: 'en',
    consent: true,
    snapshot: source,
  };
}
function intent(
  overrides: Partial<ComparisonInterpretation> = {},
): ComparisonInterpretation {
  return {
    decision: 'comparison',
    operation: 'compare',
    metric: 'completed_orders',
    region: 'South',
    baseline_period: '2026-07',
    comparison_period: '2026-08',
    reason: null,
    ...overrides,
  };
}

test('canonical comparison cites the captured rows and calculates the specified decrease', () => {
  const input = request();
  const result = calculateComparison(input, intent());
  assert.equal(result.status, 'answer');
  if (result.status !== 'answer') return;
  assert.equal(
    result.text,
    'Completed orders in the South decreased by 300, or 25%, from July to August 2026.',
  );
  assert.equal(result.request_id, input.request_id);
  assert.equal(result.snapshot_id, input.snapshot.snapshot_id);
  assert.equal(result.fingerprint, input.snapshot.fingerprint);
  assert.deepEqual(result.evidence.rows, input.snapshot.rows);
  assert.equal(result.evidence.calculation.difference, -300);
  assert.equal(result.evidence.calculation.percentage_change, '-25');
  assert.equal(result.evidence.rows[0].raw_value, '1,200');
  assert.equal(result.evidence.calculation.limitation, null);
});

test('different captured values, increases, equality and reversed baselines calculate independently', () => {
  const cases = [
    { july: 1200, august: 1050, expected: '-12.5', difference: -150 },
    { july: 1200, august: 1500, expected: '25', difference: 300 },
    { july: 1200, august: 1200, expected: '0', difference: 0 },
    { july: 3, august: 4, expected: '33.33', difference: 1 },
    { july: 6, august: 1, expected: '-83.33', difference: -5 },
  ];
  for (const item of cases) {
    const result = calculateComparison(
      request(snapshot(item.july, item.august)),
      intent(),
    );
    assert.equal(result.status, 'answer');
    if (result.status !== 'answer') continue;
    assert.equal(result.evidence.calculation.percentage_change, item.expected);
    assert.equal(result.evidence.calculation.difference, item.difference);
    if (item.difference === 0) assert.match(result.text, /unchanged/);
    else
      assert.match(
        result.text,
        item.difference > 0 ? /increased/ : /decreased/,
      );
  }
  const reversed = calculateComparison(
    request(),
    intent({ baseline_period: '2026-08', comparison_period: '2026-07' }),
  );
  assert.equal(reversed.status, 'answer');
  if (reversed.status !== 'answer') return;
  assert.equal(reversed.evidence.calculation.percentage_change, '33.33');
  assert.equal(reversed.evidence.calculation.difference, 300);
  assert.equal(reversed.evidence.baseline_row_id, '2026-08');
  assert.match(reversed.text, /from August to July 2026/);
});

test('zero baseline reports counts and an absolute change without an invented percentage', () => {
  for (const comparison of [0, 900]) {
    const result = calculateComparison(
      request(snapshot(0, comparison)),
      intent(),
    );
    assert.equal(result.status, 'answer');
    if (result.status !== 'answer') continue;
    assert.equal(result.evidence.calculation.percentage_change, null);
    assert.equal(result.evidence.calculation.difference, comparison);
    assert.match(result.text, /zero baseline/);
    assert.match(result.text, /Baseline: 0 orders/);
    assert.doesNotMatch(result.text, /Infinity|NaN/);
  }
});

test('integer precision survives values beyond floating-point intermediate precision', () => {
  const result = calculateComparison(
    request(snapshot(1, Number.MAX_SAFE_INTEGER)),
    intent(),
  );
  assert.equal(result.status, 'answer');
  if (result.status !== 'answer') return;
  assert.equal(
    result.evidence.calculation.percentage_change,
    '900719925474099000',
  );
  assert.equal(result.evidence.calculation.difference, 9007199254740990);
  const tiny = calculateComparison(
    request(snapshot(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1)),
    intent(),
  );
  assert.equal(tiny.status, 'answer');
  if (tiny.status === 'answer')
    assert.equal(tiny.evidence.calculation.percentage_change, '0');
});

test('missing, duplicate, wrong-year, wrong-region and repeated periods never fabricate a result', () => {
  const missing = snapshot();
  missing.rows = missing.rows.slice(0, 1);
  const duplicate = snapshot();
  duplicate.rows.push({ ...duplicate.rows[0]!, id: 'other-july' });
  const cases: [GroundedSnapshot, ComparisonInterpretation, string][] = [
    [missing, intent(), 'missing_data'],
    [duplicate, intent(), 'ambiguous_data'],
    [snapshot(), intent({ baseline_period: '2025-07' }), 'year_mismatch'],
    [snapshot(), intent({ region: 'North' }), 'region_mismatch'],
    [snapshot(), intent({ comparison_period: '2026-07' }), 'same_period'],
  ];
  for (const [source, interpretation, expected] of cases) {
    const result = calculateComparison(request(source), interpretation);
    assert.equal(result.status, 'clarification');
    assert.equal(result.reason, expected);
    assert.ok(!('evidence' in result));
  }
});

test('scope refusals and clarifications use application messages, never model prose', () => {
  for (const reason of [
    'unsupported_operation',
    'unsupported_metric',
  ] as const) {
    const result = calculateComparison(
      request(),
      intent({ decision: 'unsupported', reason }),
    );
    assert.equal(result.status, 'unsupported');
    assert.match(result.text, /completed-order/);
  }
  const result = calculateComparison(
    request(),
    intent({
      decision: 'clarification',
      reason: 'missing_periods',
      baseline_period: null,
      comparison_period: null,
    }),
  );
  assert.equal(result.status, 'clarification');
  assert.match(result.text, /two distinct months/);
});

test('Vietnamese deterministic output preserves periods, counts and decimal precision', () => {
  const input = request(snapshot(1200, 1050));
  input.language = 'vi';
  const result = calculateComparison(input, intent());
  assert.equal(result.status, 'answer');
  assert.match(result.text, /miền Nam giảm 150 đơn, tương đương 12,5%/);
  assert.match(result.text, /từ tháng 7 đến tháng 8 năm 2026/);
  if (result.status === 'answer') {
    assert.match(result.evidence.calculation.description, /1\.050 trừ 1\.200/);
    assert.equal(result.evidence.rows[0].raw_value, '1,200');
  }
});

test('known-format parsing never guesses decimal or ambiguous separators', () => {
  assert.equal(parseDisplayedCount('1,200', 'en-US'), 1200);
  assert.equal(parseDisplayedCount('1.200', 'vi-VN'), 1200);
  assert.equal(parseDisplayedCount('1200', 'en-US'), 1200);
  assert.equal(parseDisplayedCount('0', 'vi-VN'), 0);
  for (const raw of [
    '1.200',
    '1,20',
    '12,34,567',
    '1 200',
    '1,200.00',
    '-1',
    '1e3',
    'Infinity',
    '01',
    'NaN',
    '9,007,199,254,740,992',
  ]) {
    assert.equal(parseDisplayedCount(raw, 'en-US'), null, raw);
  }
  assert.equal(parseDisplayedCount('1,200', 'vi-VN'), null);
});

test('snapshot rejects duplicate rows, mismatched scope, incomplete data and inconsistent raw numbers', () => {
  assert.equal(groundedSnapshotSchema.safeParse(snapshot()).success, true);
  const mutations: ((value: GroundedSnapshot) => unknown)[] = [
    (value) => ({ ...value, is_complete: false }),
    (value) => ({ ...value, metric: 'revenue' }),
    (value) => ({ ...value, unit: 'USD' }),
    (value) => ({
      ...value,
      origin: 'https://dashboard.example.test/?token=secret',
    }),
    (value) => ({ ...value, origin: 'http://public.example.test' }),
    (value) => ({ ...value, origin: 'https://*.vercel.app' }),
    (value) => ({ ...value, pathname: '/other' }),
    (value) => ({ ...value, rows: [...value.rows, value.rows[0]] }),
    (value) => ({ ...value, rows: [{ ...value.rows[0], id: 'bad ID' }] }),
    (value) => ({ ...value, rows: [{ ...value.rows[0], value: 1199 }] }),
    (value) => ({ ...value, rows: [{ ...value.rows[0], region: 'North' }] }),
    (value) => ({ ...value, rows: [{ ...value.rows[0], period: '2026-13' }] }),
    (value) => ({ ...value, rows: [{ ...value.rows[0], period: '2025-07' }] }),
    (value) => ({ ...value, rows: [{ ...value.rows[0], value: -1 }] }),
    (value) => ({ ...value, rows: [{ ...value.rows[0], value: 1.5 }] }),
    (value) => ({
      ...value,
      rows: [{ ...value.rows[0], value: Number.MAX_SAFE_INTEGER + 1 }],
    }),
    (value) => ({ ...value, rows: [{ ...value.rows[0], value: Infinity }] }),
    (value) => ({
      ...value,
      rows: Array.from({ length: 101 }, () => value.rows[0]),
    }),
    (value) => ({ ...value, routing: { execute: 'untrusted' } }),
  ];
  for (const mutate of mutations)
    assert.equal(
      groundedSnapshotSchema.safeParse(mutate(snapshot())).success,
      false,
    );
});

test('request limits count Unicode characters and require explicit consent without extra authority fields', () => {
  const input = request();
  assert.equal(
    groundedRequestSchema.safeParse({ ...input, question: '😀'.repeat(1000) })
      .success,
    true,
  );
  for (const extra of [
    { question: '😀'.repeat(1001) },
    { question: '  ' },
    { consent: false },
    { userId: 'supplied-user' },
    { workspaceId: 'supplied-workspace' },
    { session_id: 'foreign-persisted-session' },
    { language: 'fr' },
  ])
    assert.equal(
      groundedRequestSchema.safeParse({ ...input, ...extra }).success,
      false,
    );
});

test('interpretation validates decision completeness and rejects invented operations or model answers', () => {
  assert.equal(
    comparisonInterpretationSchema.safeParse(intent()).success,
    true,
  );
  for (const extra of [
    { operation: 'click' },
    { metric: 'revenue' },
    { region: null },
    { baseline_period: 'July' },
    { decision: 'clarification', reason: null },
    { answer: '25%' },
    { source_id: 'invented' },
  ])
    assert.equal(
      comparisonInterpretationSchema.safeParse({ ...intent(), ...extra })
        .success,
      false,
    );
});

test('fingerprint binds relevant content and context while capture identities remain separate', async () => {
  const input = snapshot();
  const first = await fingerprintSnapshot(input);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(
    await fingerprintSnapshot({
      ...input,
      snapshot_id: crypto.randomUUID(),
      document_key: crypto.randomUUID(),
      captured_at: '2026-09-20T06:00:01.000Z',
    }),
    first,
  );
  assert.notEqual(await fingerprintSnapshot(snapshot(1200, 1050)), first);
  assert.notEqual(
    await fingerprintSnapshot({ ...input, region: 'North' }),
    first,
  );
  assert.notEqual(
    await fingerprintSnapshot({ ...input, table_title: 'Changed title' }),
    first,
  );
  assert.notEqual(
    await fingerprintSnapshot({
      ...input,
      origin: 'https://another.example.test',
    }),
    first,
  );
});
