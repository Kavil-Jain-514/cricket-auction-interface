import { describe, expect, test } from "vitest";
import { connectionView } from "./connection";

describe("connectionView (AUDIT 2026-10 P1-13)", () => {
  const base = { hasEverConnected: true, connected: true, downSince: null, now: 100_000 };

  test("before the first connection there is nothing to report", () => {
    expect(connectionView({ ...base, hasEverConnected: false, connected: false })).toEqual({ kind: "connecting" });
  });

  test("connected is live", () => {
    expect(connectionView(base)).toEqual({ kind: "live" });
  });

  test("a blip under the debounce still reads as live", () => {
    expect(connectionView({ ...base, connected: false, downSince: 99_500 })).toEqual({ kind: "live" });
  });

  test("a real drop reports how stale the screen is", () => {
    expect(connectionView({ ...base, connected: false, downSince: 88_000 })).toEqual({
      kind: "reconnecting",
      secondsStale: 12,
      offerReload: false,
    });
  });

  test("after 15 s it offers a reload (iOS can resume with a dead socket)", () => {
    expect(connectionView({ ...base, connected: false, downSince: 80_000 })).toMatchObject({ offerReload: true });
  });
});
