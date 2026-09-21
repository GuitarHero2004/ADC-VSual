import { z } from 'zod';

/** Application ceilings, shared by capture, transport and the backend. */
export const STRUCTURED_LIMITS = {
  textCodePoints: 20_000,
  bodyBytes: 512 * 1024,
  inputTokens: 6_000,
  outputTokens: 600,
  taskTimeoutMs: 45_000,
  questionCodePoints: 1_000,
  answerCodePoints: 1_000,
  maxSections: 100,
  maxBlocks: 400,
} as const;

const text = (maximum: number) =>
  z
    .string()
    .refine(
      (value) => value.trim().length > 0 && Array.from(value).length <= maximum,
    );
export const structuredOriginSchema = z
  .string()
  .max(300)
  .refine((value) => {
    const url = URL.parse(value);
    return (
      !!url &&
      ['http:', 'https:'].includes(url.protocol) &&
      url.origin === value &&
      !url.username &&
      !url.password &&
      !url.hostname.includes('*')
    );
  });
export const structuredPathnameSchema = z
  .string()
  .max(2048)
  .refine(
    (value) =>
      value.startsWith('/') &&
      !value.startsWith('//') &&
      !/[?#\\\s]/u.test(value),
  );
export const structuredSectionIdSchema = z.string().regex(/^s[1-9]\d{0,2}$/);
export const structuredBlockIdSchema = z.string().regex(/^b[1-9]\d{0,3}$/);
export const structuredLimitationSchema = z.enum([
  'text_budget',
  'tables',
  'frames',
  'canvas',
  'diagrams',
  'collapsed_content',
  'pagination',
  'unloaded_content',
]);
export type StructuredLimitation = z.infer<typeof structuredLimitationSchema>;
export const structuredSectionSchema = z.strictObject({
  id: structuredSectionIdSchema,
  heading: text(160),
});
export const structuredBlockSchema = z.strictObject({
  id: structuredBlockIdSchema,
  section_id: structuredSectionIdSchema,
  kind: z.enum(['heading', 'paragraph', 'list_item']),
  text: text(STRUCTURED_LIMITS.textCodePoints),
});
export const structuredSnapshotSchema = z
  .strictObject({
    source_kind: z.literal('structured_page'),
    snapshot_id: z.uuid(),
    captured_at: z.iso.datetime().max(40),
    origin: structuredOriginSchema,
    pathname: structuredPathnameSchema,
    title: text(160),
    document_key: z.uuid(),
    window_id: z.number().int().nonnegative(),
    tab_id: z.number().int().nonnegative(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    sections: z
      .array(structuredSectionSchema)
      .min(1)
      .max(STRUCTURED_LIMITS.maxSections),
    blocks: z
      .array(structuredBlockSchema)
      .min(1)
      .max(STRUCTURED_LIMITS.maxBlocks),
    coverage: z.strictObject({
      partial: z.boolean(),
      limitations: z
        .array(structuredLimitationSchema)
        .max(structuredLimitationSchema.options.length),
      included_sections: z
        .array(structuredSectionIdSchema)
        .min(1)
        .max(STRUCTURED_LIMITS.maxSections),
    }),
  })
  .superRefine((snapshot, context) => {
    const sections = new Set(snapshot.sections.map((section) => section.id));
    const blocks = new Set(snapshot.blocks.map((block) => block.id));
    const included = new Set(snapshot.coverage.included_sections);
    const textLength =
      Array.from(snapshot.title).length +
      snapshot.sections.reduce(
        (total, section) => total + Array.from(section.heading).length,
        0,
      ) +
      snapshot.blocks.reduce(
        (total, block) => total + Array.from(block.text).length,
        0,
      );
    if (
      sections.size !== snapshot.sections.length ||
      blocks.size !== snapshot.blocks.length ||
      included.size !== snapshot.coverage.included_sections.length ||
      included.size !== sections.size ||
      [...included].some((id) => !sections.has(id)) ||
      snapshot.blocks.some((block) => !sections.has(block.section_id)) ||
      [...sections].some(
        (id) => !snapshot.blocks.some((block) => block.section_id === id),
      ) ||
      !snapshot.blocks.some((block) => block.kind !== 'heading') ||
      new Set(snapshot.coverage.limitations).size !==
        snapshot.coverage.limitations.length ||
      (snapshot.coverage.limitations.length > 0 &&
        !snapshot.coverage.partial) ||
      textLength > STRUCTURED_LIMITS.textCodePoints
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Captured content, references or coverage are inconsistent or too large.',
      });
    }
  });
export type StructuredSnapshot = z.infer<typeof structuredSnapshotSchema>;

/** Detects changes; it is not proof that a browser client is authentic or authorised. */
export async function fingerprintStructuredSnapshot(
  snapshot: Omit<StructuredSnapshot, 'fingerprint'> | StructuredSnapshot,
): Promise<string> {
  const canonical = JSON.stringify({
    source_kind: snapshot.source_kind,
    origin: snapshot.origin,
    pathname: snapshot.pathname,
    title: snapshot.title,
    document_key: snapshot.document_key,
    window_id: snapshot.window_id,
    tab_id: snapshot.tab_id,
    sections: snapshot.sections,
    blocks: snapshot.blocks,
    coverage: snapshot.coverage,
  });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export const structuredRequestSchema = z
  .strictObject({
    request_id: z.uuid(),
    question: text(STRUCTURED_LIMITS.questionCodePoints),
    consent: z.literal(true),
    snapshot: structuredSnapshotSchema,
    section_id: structuredSectionIdSchema.optional(),
  })
  .superRefine((request, context) => {
    if (
      request.section_id &&
      !request.snapshot.sections.some(
        (section) => section.id === request.section_id,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['section_id'],
        message: 'Choose a captured section.',
      });
    }
  });
export type StructuredRequest = z.infer<typeof structuredRequestSchema>;

// Plain schema for the provider's strict Structured Outputs. Refinements are checked separately.
export const structuredModelResponseSchema = z.strictObject({
  status: z.enum(['answer', 'clarification', 'unsupported']),
  answer_language: z.enum(['en', 'vi']),
  text: z.string().min(1),
  evidence_ids: z.array(structuredBlockIdSchema).max(8),
});
export type StructuredModelResponse = z.infer<
  typeof structuredModelResponseSchema
>;
export const structuredResponseSchema = structuredModelResponseSchema
  .extend({
    source_kind: z.literal('structured_page'),
    request_id: z.uuid(),
    snapshot_id: z.uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    included_section_ids: z
      .array(structuredSectionIdSchema)
      .min(1)
      .max(STRUCTURED_LIMITS.maxSections),
    partial: z.boolean(),
  })
  .superRefine((response, context) => {
    if (
      !response.text.trim() ||
      Array.from(response.text).length > STRUCTURED_LIMITS.answerCodePoints ||
      (response.status === 'answer' && response.evidence_ids.length === 0) ||
      new Set(response.evidence_ids).size !== response.evidence_ids.length
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'The answer must be bounded and have valid evidence references.',
      });
    }
  });
export type StructuredResponse = z.infer<typeof structuredResponseSchema>;
