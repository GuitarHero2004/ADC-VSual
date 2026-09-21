import 'server-only';
import type { UsageLimit, VoiceErrorCode } from '@adc/contracts';

export class VoiceError extends Error {
  readonly code: VoiceErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly usage: UsageLimit | undefined;
  constructor(
    code: VoiceErrorCode,
    message: string,
    status: number,
    retryable = false,
    usage?: UsageLimit,
  ) {
    super(message);
    this.name = 'VoiceError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.usage = usage;
  }
}
