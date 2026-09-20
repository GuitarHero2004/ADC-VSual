import {
  groundedResponseSchema,
  voiceErrorResponseSchema,
} from '@adc/contracts';
import type { GroundedTransport } from './grounded-controller.ts';

export function createGroundedTransport(options: {
  baseUrl: string;
  getHeaders(): Promise<Record<string, string>>;
  onUnauthenticated(): void;
}): GroundedTransport {
  return async (input, signal) => {
    const headers = await options.getHeaders();
    signal.throwIfAborted();
    const response = await fetch(`${options.baseUrl}/api/grounded-read`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'X-Request-ID': input.request_id,
      },
      credentials: 'omit',
      cache: 'no-store',
      signal,
      body: JSON.stringify(input),
    });
    signal.throwIfAborted();
    if (!response.headers.get('content-type')?.includes('application/json'))
      throw Object.assign(
        new Error('Backend unavailable or deployment protection'),
        { code: 'DEPLOYMENT_UNAVAILABLE' },
      );
    const payload: unknown = await response.json();
    signal.throwIfAborted();
    if (response.status === 401) options.onUnauthenticated();
    if (!response.ok) {
      const failure = voiceErrorResponseSchema.safeParse(payload);
      throw Object.assign(new Error('Grounded request failed'), {
        code: failure.success ? failure.data.error.code : 'PROVIDER_FAILURE',
      });
    }
    return groundedResponseSchema.parse(payload);
  };
}
