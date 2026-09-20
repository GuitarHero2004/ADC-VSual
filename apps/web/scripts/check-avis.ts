import assert from 'node:assert/strict';
import { fingerprintSnapshot, groundedRequestSchema } from '@adc/contracts';
import { interpretComparison } from '../utils/grounded/server.ts';
import { calculateComparison } from '../utils/grounded/comparison.ts';
import { VoiceError } from '../utils/voice/errors.ts';

// Explicit developer-only provider check, never part of CI or the user request path.
// Uses synthetic data, spends one model request and does not test application sign-in.
const started = performance.now();
try {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 1 && args[0] === '--vi'));
  const language = args[0] === '--vi' ? 'vi' : 'en';
  const input = groundedRequestSchema.parse({
    request_id: crypto.randomUUID(),
    question:
      language === 'vi'
        ? 'So sánh số đơn hoàn thành ở miền Nam tháng 8 với tháng 7 năm 2026.'
        : 'Compare completed orders in the South for August and July.',
    language,
    consent: true,
    snapshot: {
      snapshot_id: crypto.randomUUID(),
      document_key: crypto.randomUUID(),
      adapter_key: 'orders-fixture@1',
      captured_at: new Date().toISOString(),
      origin: 'https://synthetic.example',
      pathname: '/orders',
      title: 'Synthetic provider smoke check',
      table_title: 'Completed orders — South, 2026',
      region: 'South',
      year: 2026,
      metric: 'completed_orders',
      unit: 'orders',
      locale: 'en-US',
      is_complete: true,
      rows: [
        {
          id: 'july',
          period: '2026-07',
          region: 'South',
          raw_value: '1,200',
          value: 1200,
        },
        {
          id: 'august',
          period: '2026-08',
          region: 'South',
          raw_value: '900',
          value: 900,
        },
      ],
      fingerprint: '0'.repeat(64),
    },
  });
  input.snapshot.fingerprint = await fingerprintSnapshot(input.snapshot);
  console.log(
    'Making one synthetic Avis request. This uses provider quota; no automatic retries.',
  );
  const interpretation = await interpretComparison(
    input,
    new AbortController().signal,
  );
  const result = calculateComparison(input, interpretation);
  assert.equal(result.status, 'answer');
  if (result.status !== 'answer') throw new Error('Expected a comparison');
  assert.equal(result.evidence.calculation.difference, -300);
  assert.equal(result.evidence.calculation.percentage_change, '-25');
  assert.equal(result.evidence.baseline_row_id, 'july');
  assert.equal(result.evidence.comparison_row_id, 'august');
  console.log(
    JSON.stringify({
      status: 'passed',
      language,
      duration_ms: Math.round(performance.now() - started),
    }),
  );
} catch (error) {
  // Do not print provider payloads, keys, questions, or response content.
  console.error(
    JSON.stringify({
      status: 'failed',
      code: error instanceof VoiceError ? error.code : 'CHECK_FAILED',
      duration_ms: Math.round(performance.now() - started),
    }),
  );
  process.exitCode = 1;
}
