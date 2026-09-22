import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  DESKTOP_LIMITATIONS,
  desktopRequestSchema,
  fingerprintDesktopSnapshot,
  type DesktopRequest,
} from '@adc/contracts';

/** Generated pixels only; no application content or working credentials. */
export async function desktopFixture(): Promise<DesktopRequest> {
  const bytes = await sharp({
    create: { width: 160, height: 120, channels: 3, background: '#137f39' },
  })
    .png()
    .toBuffer();
  const now = new Date().toISOString();
  const input = desktopRequestSchema.parse({
    request_id: crypto.randomUUID(),
    question: 'Describe the visible window.',
    consent: true,
    snapshot: {
      source_kind: 'desktop_window',
      snapshot_id: crypto.randomUUID(),
      source_id: crypto.randomUUID(),
      title: 'Selected synthetic window',
      captured_at: now,
      fingerprint: '0'.repeat(64),
      limitations: [...DESKTOP_LIMITATIONS],
      images: [
        {
          id: 'image-1',
          sha256: createHash('sha256').update(bytes).digest('hex'),
          captured_at: now,
          width: 160,
          height: 120,
          redactions: [],
        },
      ],
    },
    images: [
      {
        id: 'image-1',
        mime_type: 'image/png',
        base64: bytes.toString('base64'),
      },
    ],
  });
  input.snapshot.fingerprint = await fingerprintDesktopSnapshot(input.snapshot);
  return input;
}

export const desktopModelAnswer = {
  status: 'answer' as const,
  answer_language: 'en' as const,
  text: 'The captured window shows a green area.',
  evidence: [
    {
      image_id: 'image-1' as const,
      region: { x: 0, y: 0, width: 1, height: 1 },
      description: 'A green area fills this captured window.',
    },
  ],
};
