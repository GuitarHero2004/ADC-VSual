import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  fingerprintVisualSnapshot,
  visualRequestSchema,
  type VisualRequest,
} from '@adc/contracts';

export const VISUAL_SMOKE_QUESTION =
  'Read the exact prominent label in each image, in image order. Cite both images and include each label in its supporting description.';

/** Synthetic-only test inputs; no browser content or usable credentials. */
export async function visualFixture(images?: Buffer[]): Promise<VisualRequest> {
  const buffers = images ?? [
    await sharp({
      create: { width: 160, height: 160, channels: 3, background: '#137f39' },
    })
      .png()
      .toBuffer(),
  ];
  const now = new Date().toISOString();
  const metadata = await Promise.all(
    buffers.map(async (bytes, index) => {
      const info = await sharp(bytes).metadata();
      return {
        id: `image-${index + 1}`,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        captured_at: now,
        width: info.width,
        height: info.height,
        viewport_width: info.width,
        viewport_height: info.height,
        scroll_x: 0,
        scroll_y: index * info.height * 0.8,
        scale_x: 1,
        scale_y: 1,
        redactions: [],
      };
    }),
  );
  const input = visualRequestSchema.parse({
    request_id: crypto.randomUUID(),
    consent: true,
    question: 'Describe the captured image.',
    snapshot: {
      source_kind: 'visual_page',
      snapshot_id: crypto.randomUUID(),
      captured_at: now,
      capture_started_at: now,
      fingerprint: '0'.repeat(64),
      origin: 'https://synthetic.example',
      pathname: '/visual',
      title: 'Synthetic visual fixture',
      document_key: crypto.randomUUID(),
      resource_key: '1'.repeat(64),
      window_id: 1,
      tab_id: 2,
      scope: buffers.length === 1 ? 'current_view' : 'first_portion',
      images: metadata,
      coverage: {
        scroll_width: metadata[0]!.width,
        scroll_height: 10_000,
        geometric_complete: false,
        limitations:
          buffers.length === 1
            ? ['current_view_only', 'document_not_retrieved']
            : [
                'first_portion_only',
                'sequential_captures',
                'document_not_retrieved',
              ],
      },
    },
    images: buffers.map((bytes, index) => ({
      id: `image-${index + 1}`,
      mime_type: 'image/png',
      base64: bytes.toString('base64'),
    })),
  });
  input.snapshot.fingerprint = await fingerprintVisualSnapshot(input.snapshot);
  return input;
}
export const visualAnswer = {
  status: 'answer' as const,
  answer_language: 'en' as const,
  text: 'The captured image shows a green area.',
  evidence: [
    {
      image_id: 'image-1' as const,
      region: { x: 0, y: 0, width: 1, height: 1 },
      description: 'A green area fills the captured image.',
    },
  ],
};
