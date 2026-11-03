"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { editAmount, formatAmount, parseAmount } from "@/lib/amount";

type AmountInputProps = Omit<React.ComponentProps<"input">, "type" | "value" | "defaultValue" | "onChange"> & {
  /** Whole rupees; undefined = empty. */
  value: number | undefined;
  onValueChange: (value: number | undefined) => void;
};

/**
 * A rupee amount field that shows Indian separators as you type (12,34,567)
 * and reports a plain whole number. Paste, a mobile numeric keypad and caret
 * position all behave; letters and decimals are ignored. Validation (min,
 * max, required) stays with the form and the server.
 */
export function AmountInput({ value, onValueChange, onKeyDown, ref, ...props }: AmountInputProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const lastKey = React.useRef<"Backspace" | "Delete" | undefined>(undefined);
  const pendingCaret = React.useRef<number | null>(null);
  const [text, setText] = React.useState(() => (value === undefined ? "" : formatAmount(value)));
  // A rejected keystroke (a letter) leaves `text` unchanged; re-render anyway
  // so the caret is put back where it was.
  const [, rerender] = React.useReducer((n: number) => n + 1, 0);

  // A new value from outside (reset, load) replaces the text; our own edits
  // already match it.
  const [shownValue, setShownValue] = React.useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    if (parseAmount(text) !== value) setText(value === undefined ? "" : formatAmount(value));
  }

  React.useLayoutEffect(() => {
    const el = inputRef.current;
    if (pendingCaret.current === null || !el || document.activeElement !== el) return;
    el.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });

  const setRefs = (el: HTMLInputElement | null) => {
    inputRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };

  return (
    <Input
      {...props}
      ref={setRefs}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={text}
      onKeyDown={(e) => {
        lastKey.current = e.key === "Backspace" || e.key === "Delete" ? e.key : undefined;
        onKeyDown?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        const next = editAmount(text, raw, e.target.selectionEnd ?? raw.length, lastKey.current);
        lastKey.current = undefined;
        pendingCaret.current = next.caret;
        setText(next.text);
        rerender();
        setShownValue(parseAmount(next.text));
        onValueChange(parseAmount(next.text));
      }}
    />
  );
}
