import {
  createVoiceHandler,
  voicePreflight,
} from '../../../../utils/voice/http';
import {
  verifyVoiceUser,
  reserveVoiceRequest,
} from '../../../../utils/voice/access';
import {
  requireVoiceConfiguration,
  synthesiseSpeech,
  transcribeAudio,
} from '../../../../utils/elevenlabs/server';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const POST = createVoiceHandler('speak', {
  verifyVoiceUser,
  reserveVoiceRequest,
  requireVoiceConfiguration,
  synthesiseSpeech,
  transcribeAudio,
});
export const OPTIONS = voicePreflight;
