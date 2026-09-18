import { randomUUID } from 'node:crypto';
import { healthResponseSchema } from '@adc/contracts';
import { version } from '../../../package.json';

// Liveness is deliberately independent of future auth, database and providers.
export function GET() {
  const body = healthResponseSchema.parse({
    status: 'ok',
    build_version: version,
    request_id: randomUUID(),
  });

  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
