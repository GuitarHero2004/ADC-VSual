import type { AuthFailureCode } from '@adc/contracts';

export type DesktopAuthErrorCode = AuthFailureCode | 'UNAUTHENTICATED';

/** Safe to publish to the renderer. Credentials remain in the main process. */
export interface DesktopSessionState {
  phase: 'signed_out' | 'signing_in' | 'signed_in' | 'unavailable';
  account: { id: string; email: string } | null;
  workspace: 'unknown' | 'allowed' | 'denied' | 'unavailable';
  epoch: string;
  errorCode: DesktopAuthErrorCode | null;
  logoutConfirmed: boolean | null;
}
