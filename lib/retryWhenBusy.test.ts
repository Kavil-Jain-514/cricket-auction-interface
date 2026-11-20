import { ConvexError } from "convex/values";
import { describe, expect, test, vi } from "vitest";
import { isBusyError, retryWhenBusy } from "./retryWhenBusy";

const busyRegister = () => new ConvexError("Too many registrations right now. Try again in a minute.");
const busyUpload = () => new ConvexError("Too many uploads right now. Try again in a minute.");
const perPhone = () => new ConvexError("Too many registrations from this phone number today. Try again tomorrow.");

/** fn that throws each of `errors` in turn, then resolves "ok". */
function failing(...errors: unknown[]) {
  return vi.fn(async () => {
    if (errors.length) throw errors.shift();
    return "ok";
  });
}

describe("isBusyError", () => {
  test("only the per-tournament busy refusals count", () => {
    expect(isBusyError(busyRegister())).toBe(true);
    expect(isBusyError(busyUpload())).toBe(true);
    expect(isBusyError(perPhone())).toBe(false);
    expect(isBusyError(new ConvexError("Registration is closed"))).toBe(false);
    expect(isBusyError(new Error("Failed to fetch"))).toBe(false);
  });
});

describe("retryWhenBusy", () => {
  test("retries busy refusals, with the injected sleep and jitter, then returns the result", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const onRetry = vi.fn();
    const fn = failing(busyRegister(), busyUpload());
    await expect(retryWhenBusy(fn, { sleep, random: () => 0.5, baseDelayMs: 1000, onRetry })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    // cap 1000 then 2000; wait = cap/2 + random*cap/2
    expect(sleep.mock.calls).toEqual([[750], [1500]]);
    expect(onRetry.mock.calls).toEqual([[1], [2]]);
  });

  test("never waits longer than the max delay", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fn = failing(...Array.from({ length: 5 }, busyRegister));
    await retryWhenBusy(fn, { sleep, random: () => 1, baseDelayMs: 1000, maxDelayMs: 3000 });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 3000, 3000, 3000]);
  });

  test("rethrows validation errors at once", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const err = new ConvexError("Age must be between 5 and 80");
    const fn = failing(err);
    await expect(retryWhenBusy(fn, { sleep })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("does not retry the per-phone daily limit", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const err = perPhone();
    const fn = failing(err);
    await expect(retryWhenBusy(fn, { sleep })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("gives up after N attempts with the last busy error", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const errors = Array.from({ length: 4 }, busyRegister);
    const fn = failing(...errors);
    await expect(retryWhenBusy(fn, { sleep, random: () => 0, attempts: 3 })).rejects.toBe(errors[2]);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
