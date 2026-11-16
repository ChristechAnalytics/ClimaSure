// API keys live in sessionStorage: one browser tab, cleared when the tab closes.
// Exposed as a tiny external store so React can subscribe to changes.

export const CLIENT_KEY = "climasure.key";
export const ADMIN_KEY = "climasure.admin";

const listeners = new Set<() => void>();

export function readKey(name: string): string | null {
  try {
    return sessionStorage.getItem(name);
  } catch {
    return null;
  }
}

export function writeKey(name: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(name);
    else sessionStorage.setItem(name, value);
  } catch {
    /* storage blocked: the session just won't survive a reload */
  }
  listeners.forEach((l) => l());
}

export function subscribeKeys(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
