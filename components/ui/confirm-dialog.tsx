"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * App-wide confirmation dialog.
 *
 * Replaces native `window.confirm()` (unstylable, main-thread-blocking, and
 * jarring against the app's dark theme) with a single themed, accessible
 * dialog exposed through a promise-based `useConfirm()` hook. Call sites keep
 * the same control flow they had with confirm():
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title, description }))) return;
 *
 * One dialog instance is mounted at the provider, so individual components
 * don't each ship their own modal markup (DRY / single responsibility).
 */

export type ConfirmVariant = "danger" | "default";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
  /**
   * For irreversible actions: Confirm stays disabled until this text is typed
   * (trimmed, any case). The server re-checks it; this is the visible gate.
   */
  requireTypedText?: string;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within a <ConfirmProvider>");
  }
  return ctx;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState("");
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    // If a dialog is already open, resolve its pending promise as false before
    // replacing it — otherwise that caller's `await confirm(...)` would hang
    // forever, and its resolver would be silently overwritten.
    resolverRef.current?.(false);
    setTyped("");
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const close = useCallback((result: boolean) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  // Escape cancels globally. Enter is intentionally NOT handled here: a global
  // Enter would confirm even when focus is on Cancel or when the user hits
  // Enter out of habit. Instead the Confirm button is autoFocus'd, so Enter is
  // handled by the focused button and confirms only when Confirm has focus.
  useEffect(() => {
    if (!options) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options, close]);

  const isDanger = options?.variant !== "default"; // default to danger styling
  const typedOk =
    !options?.requireTypedText ||
    typed.trim().toLowerCase() === options.requireTypedText.trim().toLowerCase();

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-100 flex items-center justify-center p-4"
          onClick={() => close(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div
                className={`p-3 rounded-full shrink-0 ${
                  isDanger ? "bg-red-500/20" : "bg-blue-500/20"
                }`}
              >
                {isDanger ? (
                  <AlertTriangle className="w-6 h-6 text-red-500" />
                ) : (
                  <Info className="w-6 h-6 text-blue-400" />
                )}
              </div>
              <div className="min-w-0">
                <h3
                  id="confirm-dialog-title"
                  className="text-xl font-bold text-white"
                >
                  {options.title}
                </h3>
                {options.description && (
                  <p className="text-slate-400 text-sm mt-1 whitespace-pre-line">
                    {options.description}
                  </p>
                )}
              </div>
            </div>

            {options.requireTypedText && (
              <label className="block mt-4 text-sm text-slate-300">
                Type <span className="font-semibold text-white">{options.requireTypedText}</span> to confirm
                <input
                  autoFocus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-red-500"
                  aria-label={`Type ${options.requireTypedText} to confirm`}
                />
              </label>
            )}

            <div className="flex gap-3 mt-6">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => close(false)}
              >
                {options.cancelText || "Cancel"}
              </Button>
              <Button
                autoFocus={!options.requireTypedText}
                disabled={!typedOk}
                className={`flex-1 ${
                  isDanger ? "bg-red-600 hover:bg-red-700 text-white" : ""
                }`}
                onClick={() => typedOk && close(true)}
              >
                {options.confirmText || "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
