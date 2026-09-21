import type { OrdersContext, OrdersInvalidation } from './page-context.ts';
import type { OrdersPageResponse } from './orders-adapter.ts';

export const FLOATING_HOST_PORT = 'floating-host';
export const FLOATING_SURFACE_PORT = 'floating-surface';
export const floatingBootPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type FloatingHostCommand =
  | { type: 'floating:registered' }
  | { type: 'floating:mount' }
  | {
      type: 'floating:layout';
      expanded: boolean;
      height?: number;
      launcher?: boolean;
      width?: number;
    }
  | { type: 'floating:focus-page' }
  | { type: 'floating:remove' };
export type FloatingSurfaceMessage =
  | { type: 'floating:bound'; context: OrdersContext }
  | { type: 'floating:activate'; id: string; record: boolean }
  | { type: 'floating:invalidated'; reason: OrdersInvalidation }
  | { type: 'floating:cancel' }
  | { type: 'floating:ended' }
  | OrdersPageResponse;
export type FloatingEvent =
  | { type: 'activate'; id: string; record: boolean }
  | { type: 'cancel' }
  | { type: 'ended' };

export function exactMessage(
  value: unknown,
  type: string,
  fields: string[] = [],
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'type' in value &&
    value.type === type &&
    Object.keys(value).length === fields.length + 1 &&
    fields.every((field) => field in value)
  );
}

export function parseFloatingHostCommand(
  value: unknown,
): FloatingHostCommand | null {
  if (
    exactMessage(value, 'floating:registered') ||
    exactMessage(value, 'floating:mount') ||
    exactMessage(value, 'floating:focus-page') ||
    exactMessage(value, 'floating:remove')
  )
    return value as FloatingHostCommand;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (
    message.type !== 'floating:layout' ||
    typeof message.expanded !== 'boolean' ||
    Object.keys(message).some(
      (key) =>
        !['type', 'expanded', 'height', 'launcher', 'width'].includes(key),
    ) ||
    ('launcher' in message && typeof message.launcher !== 'boolean') ||
    (message.launcher === true && message.expanded) ||
    ('height' in message && !boundedDimension(message.height, 700)) ||
    ('width' in message &&
      (message.launcher !== true || !boundedDimension(message.width, 480)))
  )
    return null;
  return message as FloatingHostCommand;
}

function boundedDimension(value: unknown, maximum: number) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 44 &&
    value <= maximum
  );
}
