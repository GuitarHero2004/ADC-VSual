import {
  extensionHosts,
  ordersMatches,
  publicOrigin,
} from './src/config-values.ts';

export function createManifest(
  environment: Record<string, string | undefined>,
) {
  const authOrigin = publicOrigin(
    environment.VITE_API_BASE_URL || 'http://127.0.0.1:3000',
  );
  const authUrl = authOrigin ? new URL(authOrigin) : null;
  return {
    manifest_version: 3,
    name: 'VSual - Accessible browser companion',
    description:
      'Ask about the supported orders dashboard and inspect captured evidence. Optional recorded speech and read-aloud.',
    version: '0.1.0',
    minimum_chrome_version: '116',
    permissions: ['sidePanel', 'storage', 'identity'],
    ...(authUrl
      ? {
          externally_connectable: {
            matches: [`${authUrl.protocol}//${authUrl.hostname}/auth/sign-in*`],
          },
        }
      : {}),
    host_permissions: extensionHosts(environment),
    action: { default_title: 'Open VSual companion' },
    background: { service_worker: 'background.js', type: 'module' },
    side_panel: { default_path: 'index.html' },
    content_scripts: [
      {
        matches: ['http://*/*', 'https://*/*'],
        js: ['floating-content.js'],
        run_at: 'document_idle',
        all_frames: false,
      },
      ...(ordersMatches(environment).length
        ? [
            {
              matches: ordersMatches(environment),
              js: ['orders-content.js'],
              run_at: 'document_idle',
              all_frames: false,
            },
          ]
        : []),
    ],
    web_accessible_resources: [
      {
        resources: ['floating.html', 'assets/*'],
        matches: ['http://*/*', 'https://*/*'],
      },
    ],
    commands: {
      'toggle-voice': {
        suggested_key: { default: 'Alt+Shift+A' },
        description: 'Open VSual; record, finish, cancel or stop',
        global: false,
      },
    },
  };
}
