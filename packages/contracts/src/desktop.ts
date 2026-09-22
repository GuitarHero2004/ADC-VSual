import { z } from 'zod';
import {
  VISUAL_LIMITS,
  validVisualRegion,
  visualImagePayloadSchema,
  visualModelResponseSchema,
} from './visual.ts';

export const DESKTOP_LIMITATIONS = [
  'current_view_only',
  'masking_unavailable',
  'document_not_retrieved',
] as const;

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const boundedText = (maximum: number) =>
  z
    .string()
    .refine(
      (value) => value.trim().length > 0 && Array.from(value).length <= maximum,
    );

export const desktopImageMetadataSchema = z.strictObject({
  id: z.literal('image-1'),
  sha256: hash,
  captured_at: z.iso.datetime().max(40),
  width: z.number().int().positive().max(VISUAL_LIMITS.longestSide),
  height: z.number().int().positive().max(VISUAL_LIMITS.longestSide),
  // This version cannot discover sensitive fields in native application windows.
  redactions: z.array(z.never()).length(0),
});

/** An opaque selected-window identity; never pretend to have a URL or DOM. */
export const desktopSnapshotSchema = z
  .strictObject({
    source_kind: z.literal('desktop_window'),
    snapshot_id: z.uuid(),
    captured_at: z.iso.datetime().max(40),
    source_id: z.uuid(),
    title: boundedText(160),
    fingerprint: hash,
    images: z.tuple([desktopImageMetadataSchema]),
    limitations: z.tuple([
      z.literal(DESKTOP_LIMITATIONS[0]),
      z.literal(DESKTOP_LIMITATIONS[1]),
      z.literal(DESKTOP_LIMITATIONS[2]),
    ]),
  })
  .superRefine((snapshot, context) => {
    const image = snapshot.images[0];
    if (
      image.width * image.height > VISUAL_LIMITS.imagePixels ||
      image.captured_at !== snapshot.captured_at
    )
      context.addIssue({
        code: 'custom',
        message: 'Desktop capture dimensions or time are inconsistent.',
      });
  });
export type DesktopSnapshot = z.infer<typeof desktopSnapshotSchema>;

export async function fingerprintDesktopSnapshot(
  snapshot: Omit<DesktopSnapshot, 'fingerprint'> | DesktopSnapshot,
) {
  const canonical = desktopSnapshotSchema.parse({
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

export const desktopRequestSchema = z.strictObject({
  request_id: z.uuid(),
  question: boundedText(VISUAL_LIMITS.questionCodePoints),
  consent: z.literal(true),
  snapshot: desktopSnapshotSchema,
  images: z.tuple([
    visualImagePayloadSchema.extend({ id: z.literal('image-1') }),
  ]),
});
export type DesktopRequest = z.infer<typeof desktopRequestSchema>;

export const desktopResponseSchema = visualModelResponseSchema
  .extend({
    source_kind: z.literal('desktop_window'),
    request_id: z.uuid(),
    snapshot_id: z.uuid(),
    source_id: z.uuid(),
    fingerprint: hash,
    captured_at: z.iso.datetime().max(40),
  })
  .superRefine((response, context) => {
    if (
      !response.text.trim() ||
      Array.from(response.text).length > VISUAL_LIMITS.answerCodePoints ||
      (response.status === 'answer' && response.evidence.length === 0) ||
      response.evidence.some(
        (item) =>
          item.image_id !== 'image-1' ||
          !item.description.trim() ||
          !validVisualRegion(item.region),
      )
    )
      context.addIssue({
        code: 'custom',
        message: 'Desktop answer or evidence is invalid.',
      });
  });
export type DesktopResponse = z.infer<typeof desktopResponseSchema>;
