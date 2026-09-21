export const ANSWER_PREFERENCES_KEY = 'vsual:answer-preferences';

/** Read synchronously before the companion can submit or schedule speech. */
export function loadAnswerSpeech(storage: Pick<Storage, 'getItem'>): boolean {
  for (const key of [ANSWER_PREFERENCES_KEY, 'voice:extension-preferences']) {
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      // We cannot establish that a previously saved OFF preference is absent.
      return false;
    }
    try {
      const saved: unknown = JSON.parse(raw ?? '{}');
      if (
        saved &&
        typeof saved === 'object' &&
        'speechEnabled' in saved &&
        typeof saved.speechEnabled === 'boolean'
      )
        return saved.speechEnabled;
    } catch {
      // Try the legacy preference if the newer record is malformed.
    }
  }
  return true;
}
