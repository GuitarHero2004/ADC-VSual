import { join } from 'node:path';

export const DESKTOP_URL = 'vsual://desktop/index.html';

/** Only packaged files can be served. No arbitrary file or remote URL access. */
export function rendererAsset(url: string, directory: string): string | null {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'vsual:' ||
      parsed.host !== 'desktop' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !/^\/(?:index\.html|assets\/[a-zA-Z0-9_-]+\.(?:js|css|png|svg|woff2))$/.test(
        parsed.pathname,
      )
    )
      return null;
    return join(directory, parsed.pathname.slice(1));
  } catch {
    return null;
  }
}

export function trustedDesktopSender(
  sameContents: boolean,
  mainFrame: boolean,
  frameUrl: string | undefined,
) {
  return sameContents && mainFrame && frameUrl === DESKTOP_URL;
}
