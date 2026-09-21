import { publicOrigin } from './config-values.ts';
import { installFloatingHost } from './floating-host.ts';

// This entry mounts an extension-owned interface only. The separate orders
// script and worker allowlist remain the sole page-extraction boundary.
installFloatingHost(document, {
  connect: () => chrome.runtime.connect({ name: 'floating-host' }),
  authOrigin: publicOrigin(
    import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000',
  ),
  frameUrl: chrome.runtime.getURL('floating.html'),
});
