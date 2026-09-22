const prefix = 'visual-notice:v1:';

/** Acknowledgement is scoped to the existing authenticated browser-session epoch. */
export async function readVisualNotice(sessionKey: string): Promise<boolean> {
  try {
    const key = prefix + sessionKey;
    return (await chrome.storage.session.get(key))[key] === true;
  } catch {
    return false;
  }
}

export async function saveVisualNotice(sessionKey: string): Promise<void> {
  // No content or credentials: only the first-use disclosure acknowledgement.
  await chrome.storage.session.set({ [prefix + sessionKey]: true });
}
