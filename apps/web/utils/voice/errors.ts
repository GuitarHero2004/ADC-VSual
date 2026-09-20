import 'server-only';
import type { VoiceErrorCode } from '@adc/contracts';

export class VoiceError extends Error {
  readonly code: VoiceErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  constructor(
    code: VoiceErrorCode,
    message: string,
    status: number,
    retryable = false,
  ) {
    super(message);
    this.name = 'VoiceError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}
