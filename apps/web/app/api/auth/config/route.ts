import { authConfiguration } from '../../../../utils/auth/access';
import { voicePreflight } from '../../../../utils/voice/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = authConfiguration;
export const OPTIONS = voicePreflight;
