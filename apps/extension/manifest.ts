import { extensionHosts, ordersMatches } from './src/config-values.ts';

export function createManifest(
  environment: Record<string, string | undefined>,
) {
  return {
    manifest_version: 3,
    name: 'VSual - Accessible browser companion',
    description:
      'Ask about the supported orders dashboard and inspect captured evidence. Optional recorded speech and read-aloud.',
    version: '0.1.0',
    minimum_chrome_version: '116',
    permissions: ['sidePanel', 'storage'],
    host_permissions: extensionHosts(environment),
    action: { default_title: 'Open VSual companion' },
    background: { service_worker: 'background.js', type: 'module' },
    side_panel: { default_path: 'index.html' },
    content_scripts: ordersMatches(environment).length
      ? [
          {
            matches: ordersMatches(environment),
            js: ['orders-content.js'],
            run_at: 'document_idle',
            all_frames: false,
          },
        ]
      : [],
    commands: {
      'toggle-voice': {
        suggested_key: { default: 'Alt+Shift+A' },
        description: 'Open VSual; record, finish, cancel or stop',
        global: false,
      },
    },
  };
}
