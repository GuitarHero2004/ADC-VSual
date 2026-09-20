import {
  authReplySchema,
  type AuthPanelMessage,
  type AuthStatus,
} from '@adc/contracts';

export async function authCommand(
  message: AuthPanelMessage,
): Promise<AuthStatus> {
  const reply = authReplySchema.parse(
    await chrome.runtime.sendMessage(message),
  );
  if (!reply.ok)
    throw Object.assign(new Error('Authentication unavailable'), {
      code: reply.error,
    });
  return reply.status;
}
export async function getAuthHeaders(userId: string, epoch: string) {
  const reply = authReplySchema.parse(
    await chrome.runtime.sendMessage({
      type: 'auth:headers',
      userId,
      epoch,
    } satisfies AuthPanelMessage),
  );
  if (!reply.ok || !reply.headers) {
    const code = !reply.ok ? reply.error : 'UNAVAILABLE';
    throw Object.assign(new Error('Authentication unavailable'), {
      code:
        code === 'SESSION_EXPIRED'
          ? 'UNAUTHENTICATED'
          : code === 'FORBIDDEN'
            ? 'FORBIDDEN'
            : 'AUTH_UNAVAILABLE',
    });
  }
  if (reply.status.epoch !== epoch || reply.status.account?.id !== userId)
    throw Object.assign(new Error('Session changed'), {
      code: 'UNAUTHENTICATED',
    });
  return reply.headers;
}
