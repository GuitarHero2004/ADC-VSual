import { createStructuredHandler } from '../../../utils/grounded/structured-http';
import {
  answerStructuredPage,
  prepareStructuredInput,
} from '../../../utils/grounded/structured-server';
import {
  reserveVoiceRequest,
  verifyVoiceUser,
} from '../../../utils/voice/access';
import { voicePreflight } from '../../../utils/voice/http';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const POST = createStructuredHandler({
  verifyVoiceUser,
  reserveVoiceRequest,
  prepareStructuredInput,
  answerStructuredPage,
});
export const OPTIONS = voicePreflight;
