import { z } from 'zod';

export const GROUNDED_QUESTION_MAX_LENGTH = 1000;
export const GROUNDED_MAX_ROWS = 100;
export const GROUNDED_MAX_BODY_BYTES = 128 * 1024;
export const GROUNDED_ADAPTER_KEY = 'orders-fixture@1';

const label = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0);
const periodSchema = z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/);
const countSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const groundedLocaleSchema = z.enum(['en-US', 'vi-VN']);
export type GroundedLocale = z.infer<typeof groundedLocaleSchema>;

/** Only the declared fixture locale determines grouping; decimal counts are invalid. */
export function parseDisplayedCount(
  displayed: string,
  locale: GroundedLocale,
): number | null {
  const raw = displayed.trim();
  const pattern =
    locale === 'en-US'
      ? /^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/
      : /^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:\.\d{3})+)$/;
  if (!pattern.test(raw)) return null;
  const parsed = Number(raw.replaceAll(locale === 'en-US' ? ',' : '.', ''));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export const groundedOriginSchema = z
  .string()
  .max(300)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.origin === value &&
        !url.hostname.includes('*') &&
        !url.username &&
        !url.password &&
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' &&
            ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      );
    } catch {
      return false;
    }
  });

export const groundedRowSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9_-]+$/),
  period: periodSchema,
  region: label(80),
  raw_value: label(40),
  value: countSchema,
});
export type GroundedRow = z.infer<typeof groundedRowSchema>;

export const groundedSnapshotSchema = z
  .strictObject({
    snapshot_id: z.uuid(),
    adapter_key: z.literal(GROUNDED_ADAPTER_KEY),
    captured_at: z.iso.datetime().max(40),
    origin: groundedOriginSchema,
    pathname: z.literal('/orders'),
    document_key: z.uuid(),
    title: label(160),
    table_title: label(160),
    region: label(80),
    year: z.number().int().min(1000).max(9999),
    metric: z.literal('completed_orders'),
    unit: z.literal('orders'),
    locale: groundedLocaleSchema,
    is_complete: z.literal(true),
    rows: z.array(groundedRowSchema).min(1).max(GROUNDED_MAX_ROWS),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .superRefine((snapshot, context) => {
    const identifiers = new Set<string>();
    const periods = new Set<string>();
    snapshot.rows.forEach((row, index) => {
      if (
        row.region !== snapshot.region ||
        Number(row.period.slice(0, 4)) !== snapshot.year ||
        parseDisplayedCount(row.raw_value, snapshot.locale) !== row.value ||
        identifiers.has(row.id) ||
        periods.has(row.period)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['rows', index],
          message:
            'Source rows must be unique, in scope and exactly parseable.',
        });
      }
      identifiers.add(row.id);
      periods.add(row.period);
    });
  });
export type GroundedSnapshot = z.infer<typeof groundedSnapshotSchema>;

/** Content freshness only: this is not proof of authenticity or authorisation. */
export async function fingerprintSnapshot(
  snapshot: Omit<GroundedSnapshot, 'fingerprint'> | GroundedSnapshot,
): Promise<string> {
  const canonical = JSON.stringify({
    adapter_key: snapshot.adapter_key,
    origin: snapshot.origin,
    pathname: snapshot.pathname,
    title: snapshot.title,
    table_title: snapshot.table_title,
    region: snapshot.region,
    year: snapshot.year,
    metric: snapshot.metric,
    unit: snapshot.unit,
    locale: snapshot.locale,
    is_complete: snapshot.is_complete,
    rows: snapshot.rows.map((row) => ({
      id: row.id,
      period: row.period,
      region: row.region,
      raw_value: row.raw_value,
      value: row.value,
    })),
  });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export const groundedRequestSchema = z.strictObject({
  request_id: z.uuid(),
  // The reviewed question determines answer language; interface/STT locales are not sent.
  question: z
    .string()
    .min(1)
    .refine(
      (text) =>
        text.trim().length > 0 &&
        Array.from(text).length <= GROUNDED_QUESTION_MAX_LENGTH,
    ),
  consent: z.literal(true),
  snapshot: groundedSnapshotSchema,
});
export type GroundedRequest = z.infer<typeof groundedRequestSchema>;

export const interpretationReasonSchema = z.enum([
  'ambiguous_scope',
  'missing_periods',
  'unsupported_metric',
  'unsupported_operation',
]);

// Every field is required (nullable where necessary) for strict Structured Outputs.
export const comparisonInterpretationSchema = z
  .strictObject({
    decision: z.enum(['comparison', 'clarification', 'unsupported']),
    // Resolved in the existing interpretation request, never from page-language metadata.
    answer_language: z.enum(['en', 'vi']),
    operation: z.literal('compare').nullable(),
    metric: z.literal('completed_orders').nullable(),
    region: label(80).nullable(),
    baseline_period: periodSchema.nullable(),
    comparison_period: periodSchema.nullable(),
    reason: interpretationReasonSchema.nullable(),
  })
  .superRefine((interpretation, context) => {
    const complete =
      interpretation.operation !== null &&
      interpretation.metric !== null &&
      interpretation.region !== null &&
      interpretation.baseline_period !== null &&
      interpretation.comparison_period !== null;
    if (
      (interpretation.decision === 'comparison' &&
        (!complete || interpretation.reason !== null)) ||
      (interpretation.decision !== 'comparison' &&
        interpretation.reason === null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Interpretation decision and scope are inconsistent.',
      });
    }
  });
export type ComparisonInterpretation = z.infer<
  typeof comparisonInterpretationSchema
>;

export const groundedReasonSchema = z.enum([
  ...interpretationReasonSchema.options,
  'region_mismatch',
  'year_mismatch',
  'same_period',
  'missing_data',
  'ambiguous_data',
]);
export type GroundedReason = z.infer<typeof groundedReasonSchema>;

export const groundedEvidenceSchema = z.strictObject({
  origin: groundedOriginSchema,
  pathname: z.literal('/orders'),
  captured_at: z.iso.datetime().max(40),
  table_title: label(160),
  region: label(80),
  year: z.number().int().min(1000).max(9999),
  metric: z.literal('completed_orders'),
  unit: z.literal('orders'),
  rows: z.tuple([groundedRowSchema, groundedRowSchema]),
  baseline_row_id: groundedRowSchema.shape.id,
  comparison_row_id: groundedRowSchema.shape.id,
  calculation: z.strictObject({
    baseline: countSchema,
    comparison: countSchema,
    difference: z
      .number()
      .int()
      .min(-Number.MAX_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER),
    percentage_change: z
      .string()
      .max(32)
      .regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/)
      .nullable(),
    description: label(1200),
    limitation: label(400).nullable(),
  }),
});
export type GroundedEvidence = z.infer<typeof groundedEvidenceSchema>;

const responseLink = {
  request_id: z.uuid(),
  snapshot_id: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  answer_language: z.enum(['en', 'vi']),
  text: label(1500),
};
export const groundedResponseSchema = z.discriminatedUnion('status', [
  z.strictObject({
    ...responseLink,
    status: z.literal('answer'),
    evidence: groundedEvidenceSchema,
  }),
  z.strictObject({
    ...responseLink,
    status: z.literal('clarification'),
    reason: groundedReasonSchema,
  }),
  z.strictObject({
    ...responseLink,
    status: z.literal('unsupported'),
    reason: groundedReasonSchema,
  }),
]);
export type GroundedResponse = z.infer<typeof groundedResponseSchema>;
