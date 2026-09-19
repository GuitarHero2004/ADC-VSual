import { extensionHosts } from './src/config-values.ts';

export function createManifest(
  environment: Record<string, string | undefined>,
) {
  return {
    manifest_version: 3,
    name: 'Browser Accessibility Agent - Voice test',
    description:
      'Record, review and read back speech. Page assistance will be connected later.',
    version: '0.1.0',
    minimum_chrome_version: '116',
    permissions: ['sidePanel', 'storage'],
    host_permissions: extensionHosts(environment),
    action: { default_title: 'Open Browser Accessibility Agent voice test' },
    background: { service_worker: 'background.js', type: 'module' },
    side_panel: { default_path: 'index.html' },
    commands: {
      'toggle-voice': {
        suggested_key: { default: 'Alt+Shift+A' },
        description: 'Open voice test; record, finish, cancel or stop',
        global: false,
      },
    },
  };
}
