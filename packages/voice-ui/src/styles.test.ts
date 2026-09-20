import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function luminance(hex: string) {
  const channels = hex.match(/[a-f\d]{2}/gi)!.map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function contrast(foreground: string, background: string) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test('the light palette meets text and essential indicator contrast', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  const palette = Object.fromEntries(
    [...css.matchAll(/--color-([\w-]+):\s*(#[a-f\d]{6})/gi)].map((token) => [
      token[1]!,
      token[2]!,
    ]),
  );
  const check = (foreground: string, background: string, minimum: number) => {
    const ratio = contrast(palette[foreground]!, palette[background]!);
    assert.ok(
      ratio >= minimum,
      `${foreground} on ${background}: ${ratio.toFixed(2)} < ${minimum}`,
    );
  };
  for (const background of ['page', 'surface', 'subtle']) {
    for (const foreground of [
      'text',
      'muted',
      'link',
      'error',
      'warning',
      'success',
    ])
      check(foreground, background, 4.5);
    for (const foreground of ['border', 'focus', 'accent'])
      check(foreground, background, 3);
  }
  check('on-accent', 'accent', 4.5);
  check('on-accent', 'accent-hover', 4.5);
  check('on-selection', 'selection', 4.5);
  check('on-disabled', 'disabled', 4.5);
  check('border', 'disabled', 3);
});
