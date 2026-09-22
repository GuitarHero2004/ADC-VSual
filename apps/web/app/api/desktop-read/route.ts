import { createDesktopHandler } from '../../../utils/grounded/desktop-http';
import {
  answerDesktopWindow,
  prepareDesktopInput,
  validateDesktopImages,
} from '../../../utils/grounded/desktop-server';
import {
  reserveVoiceRequest,
  verifyVoiceUser,
} from '../../../utils/voice/access';
import { voicePreflight } from '../../../utils/voice/http';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const POST = createDesktopHandler({
  verifyVoiceUser,
  reserveVoiceRequest,
  prepareDesktopInput,
  validateDesktopImages,
  answerDesktopWindow,
});
export const OPTIONS = voicePreflight;
