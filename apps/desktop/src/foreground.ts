import { execFile } from 'node:child_process';
import { win32 } from 'node:path';

const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition 'public static class VSualForeground { [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); }'
[Console]::Out.Write([VSualForeground]::GetForegroundWindow().ToInt64().ToString([Globalization.CultureInfo]::InvariantCulture))
`;

export type ForegroundCommandExecutor = (
  file: string,
  args: string[],
  options: {
    encoding: 'utf8';
    windowsHide: true;
    timeout: number;
    maxBuffer: number;
  },
  callback: (error: Error | null, stdout: string) => void,
) => void;

/** Reads only the foreground HWND. Call before showing or focusing VSual. */
export async function readForegroundWindow(
  options: {
    platform?: NodeJS.Platform;
    execute?: ForegroundCommandExecutor;
  } = {},
): Promise<string | null> {
  if ((options.platform ?? process.platform) !== 'win32') return null;
  const execute: ForegroundCommandExecutor = options.execute ?? execFile;
  return new Promise((resolve) => {
    try {
      execute(
        win32.join(
          process.env.SystemRoot ?? 'C:\\Windows',
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        ),
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { encoding: 'utf8', windowsHide: true, timeout: 3000, maxBuffer: 64 },
        (error, stdout) => {
          if (error || stdout.length > 64) return resolve(null);
          const value = stdout.trim();
          if (!/^[0-9]{1,20}$/.test(value)) return resolve(null);
          const handle = BigInt(value);
          resolve(
            handle > 0n && handle <= 0xffffffffffffffffn
              ? `window:${handle}:0`
              : null,
          );
        },
      );
    } catch {
      resolve(null);
    }
  });
}
