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

export const desktopFollowUpContextSchema = z.strictObject({
  request_id: z.uuid(),
  source_id: z.uuid(),
  question: boundedText(VISUAL_LIMITS.questionCodePoints),
  answer: boundedText(VISUAL_LIMITS.answerCodePoints),
});
export type DesktopFollowUpContext = z.infer<
  typeof desktopFollowUpContextSchema
>;

export const desktopRequestSchema = z
  .strictObject({
    request_id: z.uuid(),
    question: boundedText(VISUAL_LIMITS.questionCodePoints),
    consent: z.literal(true),
    snapshot: desktopSnapshotSchema,
    images: z.tuple([
      visualImagePayloadSchema.extend({ id: z.literal('image-1') }),
    ]),
    follow_up_context: desktopFollowUpContextSchema.optional(),
  })
  .superRefine((request, context) => {
    const previous = request.follow_up_context;
    if (
      previous &&
      (previous.source_id !== request.snapshot.source_id ||
        previous.request_id === request.request_id)
    )
      context.addIssue({
        code: 'custom',
        message:
          'Follow-up context must refer to an earlier request for this source.',
      });
  });
export type DesktopRequest = z.infer<typeof desktopRequestSchema>;

export const desktopFollowUpSchema = z.strictObject({
  question: boundedText(160),
  // One-based positions in this answer's validated evidence collection.
  evidence_indices: z.array(z.number().int().min(1).max(8)).min(1).max(3),
});
export type DesktopFollowUp = z.infer<typeof desktopFollowUpSchema>;

/** Required on the model route; legacy backend answers can still display without it. */
export const desktopModelResponseSchema = visualModelResponseSchema.extend({
  follow_ups: z.array(desktopFollowUpSchema).max(3),
});

export function desktopSpeechText(response: {
  text: string;
  answer_language: 'en' | 'vi';
  follow_ups: DesktopFollowUp[];
}) {
  if (!response.follow_ups.length) return response.text;
  const options = response.follow_ups
    .map((option, index) => `${index + 1}. ${option.question}`)
    .join(' ');
  return response.answer_language === 'vi'
    ? `${response.text} Bạn có thể hỏi tiếp: ${options} Nhấn phím tắt Nói rồi nói số lựa chọn hoặc hỏi câu khác.`
    : `${response.text} You can ask next: ${options} Press the Talk shortcut and say an option number, or ask something else.`;
}

export const desktopResponseSchema = desktopModelResponseSchema
  .extend({
    follow_ups: z.array(desktopFollowUpSchema).max(3).default([]),
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
      Array.from(desktopSpeechText(response)).length >
        VISUAL_LIMITS.answerCodePoints ||
      (response.status === 'answer' && response.evidence.length === 0) ||
      (response.status === 'unsupported' && response.follow_ups.length > 0) ||
      response.follow_ups.some((option) =>
        option.evidence_indices.some(
          (index) => index > response.evidence.length,
        ),
      ) ||
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
