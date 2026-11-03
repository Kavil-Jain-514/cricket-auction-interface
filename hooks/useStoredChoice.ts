"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A choice remembered in localStorage (e.g. the last dashboard tab). Starts at
 * `fallback` and reads storage after mount, so server and client render the
 * same; values not in `allowed` and blocked storage fall back silently.
 */
export function useStoredChoice<T extends string>(key: string, fallback: T, allowed: readonly T[]) {
  const [value, setValue] = useState<T>(fallback);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored && (allowed as readonly string[]).includes(stored)) setValue(stored as T);
    } catch {
      // Private mode or blocked storage: keep the fallback.
    }
    // `allowed` is a constant list at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const choose = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Not remembered; the choice still applies now.
      }
    },
    [key],
  );

  return [value, choose] as const;
}
