import { z } from 'zod';

export const AUTH_ATTEMPT_MS = 5 * 60_000;
export const authAccountSchema = z.strictObject({
  id: z.uuid(),
  email: z.string().max(320),
});
export const authFailureCodeSchema = z.enum([
  'INVALID_CREDENTIALS',
  'EMAIL_UNCONFIRMED',
  'RATE_LIMITED',
  'UNAVAILABLE',
  'SESSION_EXPIRED',
  'CANCELLED',
  'ATTEMPT_EXPIRED',
  'INVALID_ATTEMPT',
  'GOOGLE_UNAVAILABLE',
  'PROVIDER_ERROR',
  'CALLBACK_MISMATCH',
  'ACCOUNT_CHANGE_REQUIRED',
  'SETUP_REQUIRED',
  'FORBIDDEN',
]);
export type AuthFailureCode = z.infer<typeof authFailureCodeSchema>;
export const workspaceAccessSchema = z.enum([
  'unknown',
  'allowed',
  'denied',
  'unavailable',
]);
export const authStatusSchema = z.strictObject({
  phase: z.enum(['signed_out', 'signing_in', 'signed_in', 'unverified']),
  account: authAccountSchema.nullable(),
  workspace: workspaceAccessSchema,
  epoch: z.uuid(),
  attempt: z
    .strictObject({ id: z.uuid(), expiresAt: z.number().int().positive() })
    .nullable(),
  error: authFailureCodeSchema.nullable(),
  logoutConfirmed: z.boolean().nullable(),
});
export type AuthStatus = z.infer<typeof authStatusSchema>;
export const authAccessResponseSchema = z.strictObject({
  request_id: z.uuid(),
  account: authAccountSchema,
  workspace: z.enum(['allowed', 'denied', 'unavailable']),
});
export type AuthAccessResponse = z.infer<typeof authAccessResponseSchema>;
export const authCapabilitiesSchema = z.strictObject({ google: z.boolean() });
const attempt = {
  attemptId: z.uuid(),
  recipient: z.string().regex(/^[a-p]{32}$/),
};
const proof = { ...attempt, secret: z.string().regex(/^[a-f0-9]{64}$/) };
export const authWebsiteMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('auth:hello'), ...attempt }),
  z.strictObject({
    type: z.literal('auth:password'),
    ...proof,
    email: z.email().max(320),
    password: z.string().min(1).max(1024),
  }),
  z.strictObject({ type: z.literal('auth:google'), ...proof }),
  z.strictObject({ type: z.literal('auth:cancel'), ...proof }),
  z.strictObject({ type: z.literal('auth:status'), ...proof }),
  z.strictObject({ type: z.literal('auth:return'), ...proof }),
]);
export type AuthWebsiteMessage = z.infer<typeof authWebsiteMessageSchema>;
export const authPanelMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('auth:status') }),
  z.strictObject({
    type: z.literal('auth:start'),
    language: z.enum(['en', 'vi']),
    inline: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('auth:inline-password'),
    epoch: z.uuid(),
    email: z.email().max(320),
    password: z.string().min(1).max(1024),
  }),
  z.strictObject({ type: z.literal('auth:inline-google'), epoch: z.uuid() }),
  z.strictObject({ type: z.literal('auth:inline-cancel'), epoch: z.uuid() }),
  z.strictObject({ type: z.literal('auth:cancel'), epoch: z.uuid() }),
  z.strictObject({ type: z.literal('auth:logout') }),
  z.strictObject({
    type: z.literal('auth:headers'),
    userId: z.uuid(),
    epoch: z.uuid(),
  }),
]);
export type AuthPanelMessage = z.infer<typeof authPanelMessageSchema>;
export const authReplySchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(false), error: authFailureCodeSchema }),
  z.strictObject({
    ok: z.literal(true),
    status: authStatusSchema,
    secret: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    google: z.boolean().optional(),
    headers: z
      .strictObject({ Authorization: z.string().min(1).max(20_000) })
      .optional(),
  }),
]);
export type AuthReply = z.infer<typeof authReplySchema>;
