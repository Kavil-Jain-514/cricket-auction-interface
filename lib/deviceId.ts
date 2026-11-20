// lib/deviceId.ts - A random id for this browser, sent with a public
// registration so an organiser can allow one registration per device
// (settings.oneRegistrationPerDevice, enforced in convex/registrations.ts).
// It identifies the browser's storage, not the phone: clearing site data, a
// private tab or another browser gets a new one. Not personal data.

const KEY = 'bid11pro.deviceId';
let memo: string | null = null;

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * This browser's id, created on first use and kept in localStorage. When
 * storage is blocked (some private modes) it lasts for the page's lifetime.
 */
export function getDeviceId(storage: Storage | null = typeof window === 'undefined' ? null : window.localStorage): string {
  try {
    const stored = storage?.getItem(KEY);
    if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) return stored;
    const id = memo ?? newId();
    storage?.setItem(KEY, id);
    memo = id;
    return id;
  } catch {
    memo ??= newId();
    return memo;
  }
}
