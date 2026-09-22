import { z } from 'zod';
import {
  structuredOriginSchema,
  structuredPathnameSchema,
} from './structured.ts';

/** Application caps; the backend also applies the verified provider profile. */
export const VISUAL_LIMITS = {
  maxImages: 4,
  captureIntervalMs: 1_000,
  overlap: 0.2,
  preparationTimeoutMs: 2_000,
  settleTimeoutMs: 1_000,
  captureTimeoutMs: 2_000,
  captureStageTimeoutMs: 15_000,
  rawPixels: 24_000_000,
  imagePixels: 2_000_000,
  totalPixels: 8_000_000,
  longestSide: 2_000,
  imageBytes: 512 * 1024,
  totalImageBytes: 2 * 1024 * 1024,
  bodyBytes: 3 * 1024 * 1024,
  inputTokens: 8_192,
  imageTokens: 6_144,
  outputTokens: 768,
  backendTimeoutMs: 25_000,
  modelTimeoutMs: 20_000,
  speechTimeoutMs: 15_000,
  taskTimeoutMs: 60_000,
  questionCodePoints: 1_000,
  answerCodePoints: 1_000,
} as const;

/** Verified Astra original-detail profile at <=2000px; includes rounding reserve. */
export function visualImageTokenBound(width: number, height: number) {
  return Math.ceil(Math.ceil(width / 32) * Math.ceil(height / 32) * 1.2) + 1;
}

const boundedText = (maximum: number) =>
  z
    .string()
    .refine(
      (value) => value.trim().length > 0 && Array.from(value).length <= maximum,
    );
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const visualImageIdSchema = z.enum([
  'image-1',
  'image-2',
  'image-3',
  'image-4',
]);
export const visualScopeSchema = z.enum([
  'current_view',
  'rendered_page',
  'first_portion',
]);
export type VisualScope = z.infer<typeof visualScopeSchema>;
/** Coordinates refer to the transmitted bitmap, normalised to [0,1]. */
export const visualRegionSchema = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
});
export type VisualRegion = z.infer<typeof visualRegionSchema>;
export function validVisualRegion(region: VisualRegion) {
  return (
    region.x + region.width <= 1.000001 && region.y + region.height <= 1.000001
  );
}
export const visualLimitationSchema = z.enum([
  'current_view_only',
  'first_portion_only',
  'redacted_regions',
  'occluded_regions',
  'nested_scrollers',
  'horizontal_overflow',
  'unloaded_content',
  'collapsed_content',
  'frames',
  'sequential_captures',
  'dynamic_content',
  'geometry_only',
  'document_not_retrieved',
  'masking_unavailable',
]);
export type VisualLimitation = z.infer<typeof visualLimitationSchema>;
export const visualCoverageSchema = z.strictObject({
  scroll_width: z.number().positive().max(10_000_000),
  scroll_height: z.number().positive().max(10_000_000),
  geometric_complete: z.boolean(),
  limitations: z
    .array(visualLimitationSchema)
    .min(1)
    .max(visualLimitationSchema.options.length),
});
export const visualImageMetadataSchema = z.strictObject({
  id: visualImageIdSchema,
  sha256: hash,
  captured_at: z.iso.datetime().max(40),
  width: z.number().int().positive().max(VISUAL_LIMITS.longestSide),
  height: z.number().int().positive().max(VISUAL_LIMITS.longestSide),
  viewport_width: z.number().positive().max(32_768),
  viewport_height: z.number().positive().max(32_768),
  scroll_x: z.number().nonnegative().max(10_000_000),
  scroll_y: z.number().nonnegative().max(10_000_000),
  scale_x: z.number().positive().max(16),
  scale_y: z.number().positive().max(16),
  redactions: z.array(visualRegionSchema).max(200),
});
export const visualSnapshotSchema = z
  .strictObject({
    source_kind: z.literal('visual_page'),
    snapshot_id: z.uuid(),
    captured_at: z.iso.datetime().max(40),
    capture_started_at: z.iso.datetime().max(40),
    fingerprint: hash,
    origin: structuredOriginSchema,
    pathname: structuredPathnameSchema,
    title: boundedText(160),
    // Local correlation key, not an assertion of a Chrome document ID.
    document_key: z.uuid(),
    resource_key: hash,
    window_id: z.number().int().nonnegative(),
    tab_id: z.number().int().nonnegative(),
    scope: visualScopeSchema,
    images: z
      .array(visualImageMetadataSchema)
      .min(1)
      .max(VISUAL_LIMITS.maxImages),
    coverage: visualCoverageSchema,
  })
  .superRefine((snapshot, context) => {
    const { images, coverage } = snapshot;
    const start = Date.parse(snapshot.capture_started_at);
    const end = Date.parse(snapshot.captured_at);
    const geometric =
      snapshot.scope === 'rendered_page' &&
      images[0]!.scroll_y <= 1 &&
      images.every(
        (image, i) =>
          image.scroll_x <= 1 &&
          image.viewport_width + 1 >= coverage.scroll_width &&
          (i === 0 ||
            image.scroll_y <=
              images[i - 1]!.scroll_y + images[i - 1]!.viewport_height + 1),
      ) &&
      images.at(-1)!.scroll_y + images.at(-1)!.viewport_height + 1 >=
        coverage.scroll_height;
    if (
      end < start ||
      end - start > VISUAL_LIMITS.captureStageTimeoutMs ||
      (snapshot.scope === 'current_view' && images.length !== 1) ||
      images.some(
        (image, i) =>
          image.id !== `image-${i + 1}` ||
          image.width * image.height > VISUAL_LIMITS.imagePixels ||
          Math.abs(image.width - image.viewport_width * image.scale_x) > 1 ||
          Math.abs(image.height - image.viewport_height * image.scale_y) > 1 ||
          Date.parse(image.captured_at) < start ||
          Date.parse(image.captured_at) > end ||
          image.redactions.some((region) => !validVisualRegion(region)) ||
          (i > 0 &&
            (image.scroll_y < images[i - 1]!.scroll_y ||
              Date.parse(image.captured_at) <
                Date.parse(images[i - 1]!.captured_at))),
      ) ||
      images.reduce((sum, image) => sum + image.width * image.height, 0) >
        VISUAL_LIMITS.totalPixels ||
      new Set(coverage.limitations).size !== coverage.limitations.length ||
      (coverage.geometric_complete && !geometric) ||
      (snapshot.scope === 'current_view' &&
        !coverage.limitations.includes('current_view_only')) ||
      (snapshot.scope === 'first_portion' &&
        !coverage.limitations.includes('first_portion_only')) ||
      (images.some((image) => image.redactions.length > 0) &&
        !coverage.limitations.includes('redacted_regions')) ||
      (images.length > 1 &&
        !coverage.limitations.includes('sequential_captures'))
    )
      context.addIssue({
        code: 'custom',
        message: 'Visual capture metadata or coverage is inconsistent.',
      });
  });
export type VisualSnapshot = z.infer<typeof visualSnapshotSchema>;
export async function fingerprintVisualSnapshot(
  snapshot: Omit<VisualSnapshot, 'fingerprint'> | VisualSnapshot,
) {
  // Schema ordering makes caller property order irrelevant. Hash is integrity, not authority.
  const canonical = visualSnapshotSchema.parse({
    ...snapshot,
    fingerprint: '0'.repeat(64),
  });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(canonical)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
export const visualImagePayloadSchema = z.strictObject({
  id: visualImageIdSchema,
  mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  base64: z
    .string()
    .min(4)
    .max(Math.ceil(VISUAL_LIMITS.imageBytes / 3) * 4)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
});
export type VisualImagePayload = z.infer<typeof visualImagePayloadSchema>;
export const visualRequestSchema = z
  .strictObject({
    request_id: z.uuid(),
    question: boundedText(VISUAL_LIMITS.questionCodePoints),
    consent: z.literal(true),
    snapshot: visualSnapshotSchema,
    images: z
      .array(visualImagePayloadSchema)
      .min(1)
      .max(VISUAL_LIMITS.maxImages),
  })
  .superRefine((input, context) => {
    if (
      input.images.length !== input.snapshot.images.length ||
      input.images.some((image, i) => image.id !== input.snapshot.images[i]?.id)
    )
      context.addIssue({
        code: 'custom',
        message: 'Visual image payloads do not match the snapshot.',
      });
  });
export type VisualRequest = z.infer<typeof visualRequestSchema>;
// Plain provider schema; actual regions and known image references are checked afterwards.
export const visualModelResponseSchema = z.strictObject({
  status: z.enum(['answer', 'clarification', 'unsupported']),
  answer_language: z.enum(['en', 'vi']),
  text: z.string().min(1),
  evidence: z
    .array(
      z.strictObject({
        image_id: visualImageIdSchema,
        region: visualRegionSchema,
        description: z.string().min(1).max(300),
      }),
    )
    .max(8),
});
export const visualResponseSchema = visualModelResponseSchema
  .extend({
    source_kind: z.literal('visual_page'),
    request_id: z.uuid(),
    snapshot_id: z.uuid(),
    fingerprint: hash,
    scope: visualScopeSchema,
    coverage: visualCoverageSchema,
  })
  .superRefine((response, context) => {
    if (
      !response.text.trim() ||
      Array.from(response.text).length > VISUAL_LIMITS.answerCodePoints ||
      (response.status === 'answer' && !response.evidence.length) ||
      response.evidence.some(
        (item) => !item.description.trim() || !validVisualRegion(item.region),
      )
    )
      context.addIssue({
        code: 'custom',
        message: 'Visual answer or evidence is invalid.',
      });
  });
export type VisualResponse = z.infer<typeof visualResponseSchema>;
