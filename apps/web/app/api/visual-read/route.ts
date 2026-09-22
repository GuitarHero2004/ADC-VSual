import { createVisualHandler } from '../../../utils/grounded/visual-http';
import {
  answerVisualPage,
  prepareVisualInput,
  validateVisualImages,
} from '../../../utils/grounded/visual-server';
import {
  reserveVoiceRequest,
  verifyVoiceUser,
} from '../../../utils/voice/access';
import { voicePreflight } from '../../../utils/voice/http';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const POST = createVisualHandler({
  verifyVoiceUser,
  reserveVoiceRequest,
  prepareVisualInput,
  validateVisualImages,
  answerVisualPage,
});
export const OPTIONS = voicePreflight;
