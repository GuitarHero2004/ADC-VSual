import { createAuthAccessHandler } from '../../../../utils/auth/access';
import {
  verifyAuthUser,
  verifyVoiceIdentity,
} from '../../../../utils/voice/access';
import { voicePreflight } from '../../../../utils/voice/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = createAuthAccessHandler({
  verifyAuthUser,
  verifyVoiceIdentity,
});
export const OPTIONS = voicePreflight;
