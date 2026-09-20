import SignIn from './sign-in';
import { webAuthConfig } from '../../../utils/auth/web-config';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in — VSual', referrer: 'no-referrer' };

export default function SignInPage() {
  const config = webAuthConfig();
  return <SignIn googleEnabled={config.google} siteUrl={config.siteUrl} />;
}
