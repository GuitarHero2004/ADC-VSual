import { createGroundedHandler } from '../../../utils/grounded/http';
import {
  interpretComparison,
  requireGroundedConfiguration,
} from '../../../utils/grounded/server';
import {
  reserveVoiceRequest,
  verifyVoiceUser,
} from '../../../utils/voice/access';
import { voicePreflight } from '../../../utils/voice/http';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const POST = createGroundedHandler({
  verifyVoiceUser,
  reserveVoiceRequest,
  requireGroundedConfiguration,
  interpretComparison,
});
export const OPTIONS = voicePreflight;
