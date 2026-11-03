import { describe, expect, test, vi } from "vitest";
import { keepScreenAwake } from "./wakeLock";

function fakes(supported = true) {
  const sentinels: Array<{ released: boolean; release: () => Promise<void> }> = [];
  const listeners = new Map<string, () => void>();
  const doc = {
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    removeEventListener: vi.fn((type: string) => listeners.delete(type)),
  };
  const nav = supported
    ? {
        wakeLock: {
          request: vi.fn(async () => {
            const s = { released: false, release: async () => void (s.released = true) };
            sentinels.push(s);
            return s;
          }),
        },
      }
    : {};
  return { doc, nav, sentinels, listeners };
}

describe("keepScreenAwake (AUDIT 2026-10 P1-13)", () => {
  test("holds a screen wake lock and re-acquires it when the tab is visible again", async () => {
    const { doc, nav, sentinels, listeners } = fakes();
    const stop = keepScreenAwake(nav as never, doc as never);
    await Promise.resolve();
    expect(sentinels).toHaveLength(1);

    // The browser drops the lock when the tab is hidden; coming back re-requests.
    sentinels[0].released = true;
    listeners.get("visibilitychange")!();
    await Promise.resolve();
    expect(sentinels).toHaveLength(2);

    stop();
    await Promise.resolve();
    expect(sentinels[1].released).toBe(true);
    expect(doc.removeEventListener).toHaveBeenCalled();
  });

  test("does nothing where the API is missing (older Safari, OBS)", () => {
    const { doc, nav } = fakes(false);
    expect(() => keepScreenAwake(nav as never, doc as never)()).not.toThrow();
  });
});
