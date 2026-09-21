import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import SiteShell from './site-shell';
import '@adc/voice-ui/styles.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'VSual — Accessible browser companion',
  description:
    'Ask about supported HTML articles or the orders demo and inspect supporting excerpts. A companion to your screen reader.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}
