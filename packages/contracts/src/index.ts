import { z } from 'zod';

// API-07 bounds request_text. Task submission is not implemented yet.
export const REQUEST_TEXT_MAX_LENGTH = 4000;

// API-25: liveness only, with the request ID required by the API conventions.
export const healthResponseSchema = z.strictObject({
  status: z.literal('ok'),
  build_version: z.string().min(1),
  request_id: z.uuid(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
