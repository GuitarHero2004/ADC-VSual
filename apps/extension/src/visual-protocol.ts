import {
  visualSnapshotSchema,
  visualImagePayloadSchema,
  type VisualSnapshot,
  type VisualRequest,
  type VisualScope,
} from '@adc/contracts';
import { exactMessage, floatingBootPattern } from './floating-protocol.ts';
export type { VisualScope } from '@adc/contracts';
export const VISUAL_PORT = 'visual-page';
export type VisualTaskState = { capturing: boolean; recovering: boolean };
export type VisualSource = {
  tabId: number;
  windowId: number;
  origin: string;
  pathname: string;
  resourceKey: string;
  documentId?: string;
};
export type VisualCaptureResult = {
  snapshot: VisualSnapshot;
  images: VisualRequest['images'];
};
export type VisualMessage =
  | {
      type: 'visual:capture';
      id: string;
      source: VisualSource;
      scope: VisualScope;
    }
  | { type: 'visual:verify'; id: string; snapshot: VisualSnapshot }
  | { type: 'visual:cancel'; id: string }
  | { type: 'visual:reset' }
  | ({ type: 'visual:state'; source: VisualSource } & VisualTaskState);
export const visualErrorCodes = [
  'PERMISSION_REQUIRED',
  'STALE_CONTEXT',
  'CANCELLED',
  'VISUAL_UNSUPPORTED',
  'VISUAL_TOO_LARGE',
  'TIMEOUT',
  'VISUAL_BUSY',
  'VISUAL_UNSTABLE',
] as const;
export type VisualErrorCode = (typeof visualErrorCodes)[number];
export type VisualReply =
  | ({ type: 'visual:result'; id: string } & VisualCaptureResult)
  | { type: 'visual:verified'; id: string; current: boolean }
  | { type: 'visual:error'; id: string; code: VisualErrorCode }
  | { type: 'visual:cancelled' };
export function validVisualSource(value: unknown): value is VisualSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as VisualSource;
  if (
    Object.keys(value).some(
      (key) =>
        ![
          'tabId',
          'windowId',
          'origin',
          'pathname',
          'documentId',
          'resourceKey',
        ].includes(key),
    ) ||
    !Number.isInteger(source.tabId) ||
    source.tabId < 0 ||
    !Number.isInteger(source.windowId) ||
    source.windowId < 0 ||
    typeof source.origin !== 'string' ||
    typeof source.pathname !== 'string' ||
    !source.pathname.startsWith('/') ||
    typeof source.resourceKey !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(source.resourceKey) ||
    ('documentId' in source &&
      (typeof source.documentId !== 'string' || !source.documentId))
  )
    return false;
  try {
    const url = new URL(source.origin);
    return (
      ['http:', 'https:'].includes(url.protocol) && url.origin === source.origin
    );
  } catch {
    return false;
  }
}
const isExact = (value: unknown, type: string, fields: string[] = []) =>
  Boolean(exactMessage(value, type, fields));
export function parseVisualMessage(input: unknown): VisualMessage | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (isExact(value, 'visual:reset')) return { type: 'visual:reset' };
  if (
    isExact(value, 'visual:state', ['source', 'capturing', 'recovering']) &&
    validVisualSource(value.source) &&
    typeof value.capturing === 'boolean' &&
    typeof value.recovering === 'boolean'
  )
    return value as VisualMessage;
  if (
    !value ||
    typeof value !== 'object' ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !floatingBootPattern.test(value.id)
  )
    return null;
  if (isExact(value, 'visual:cancel', ['id'])) return value as VisualMessage;
  if (
    isExact(value, 'visual:capture', ['id', 'source', 'scope']) &&
    validVisualSource(value.source) &&
    ['current_view', 'rendered_page', 'first_portion'].includes(
      String(value.scope),
    )
  )
    return value as VisualMessage;
  if (isExact(value, 'visual:verify', ['id', 'snapshot'])) {
    const parsed = visualSnapshotSchema.safeParse(value.snapshot);
    if (parsed.success)
      return {
        type: 'visual:verify',
        id: value.id as string,
        snapshot: parsed.data,
      };
  }
  return null;
}
export function parseVisualReply(input: unknown): VisualReply | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (isExact(value, 'visual:cancelled')) return { type: 'visual:cancelled' };
  if (
    !value ||
    typeof value !== 'object' ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !floatingBootPattern.test(value.id)
  )
    return null;
  if (
    isExact(value, 'visual:error', ['id', 'code']) &&
    visualErrorCodes.includes(value.code as VisualErrorCode)
  )
    return value as VisualReply;
  if (
    isExact(value, 'visual:verified', ['id', 'current']) &&
    typeof value.current === 'boolean'
  )
    return value as VisualReply;
  if (isExact(value, 'visual:result', ['id', 'snapshot', 'images'])) {
    const snapshot = visualSnapshotSchema.safeParse(value.snapshot);
    if (
      !snapshot.success ||
      !Array.isArray(value.images) ||
      !value.images.length ||
      value.images.length > 4
    )
      return null;
    const images = value.images.map((image) =>
      visualImagePayloadSchema.safeParse(image),
    );
    if (images.some((image) => !image.success)) return null;
    return {
      type: 'visual:result',
      id: value.id as string,
      snapshot: snapshot.data,
      images: images.map((image) => image.data!),
    };
  }
  return null;
}

/** Resource correlation only; the raw query/fragment never crosses the UI/backend contract. */
export async function visualResourceKey(url: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(url),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
export type VisualAccessContext = {
  eligible: boolean;
  permission: 'granted' | 'required';
  resourceKey?: string;
};
