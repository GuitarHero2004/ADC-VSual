import {
  groundedResponseSchema,
  structuredResponseSchema,
  STRUCTURED_LIMITS,
  voiceErrorResponseSchema,
} from '@adc/contracts';
import type { GroundedTransport } from './grounded-controller.ts';

export function createGroundedTransport(options: {
  baseUrl: string;
  getHeaders(): Promise<Record<string, string>>;
  onUnauthenticated(): void;
}): GroundedTransport {
  return async (input, signal) => {
    const structured = 'source_kind' in input.snapshot;
    const body = JSON.stringify(input);
    if (
      structured &&
      new TextEncoder().encode(body).byteLength > STRUCTURED_LIMITS.bodyBytes
    )
      throw Object.assign(new Error('Captured request is too large'), {
        code: 'INPUT_TOO_LARGE',
      });
    const headers = await options.getHeaders();
    signal.throwIfAborted();
    const response = await fetch(
      `${options.baseUrl}/api/${structured ? 'structured-read' : 'grounded-read'}`,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'X-Request-ID': input.request_id,
        },
        credentials: 'omit',
        cache: 'no-store',
        signal,
        body,
      },
    );
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
        usage: failure.success ? failure.data.error.usage : undefined,
      });
    }
    return (
      structured ? structuredResponseSchema : groundedResponseSchema
    ).parse(payload);
  };
}
