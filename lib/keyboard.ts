// lib/keyboard.ts
// Console hotkeys must not fire while the auctioneer is typing or a dialog is open.

const TYPING_TARGETS = 'input, textarea, select, [contenteditable="true"]';

/**
 * True when a global hotkey should be ignored. `activatingKey` also skips
 * buttons and links, for keys (Enter) that already activate a focused control.
 */
export function hotkeyBelongsToSomethingElse(
  e: KeyboardEvent,
  { activatingKey = false }: { activatingKey?: boolean } = {},
): boolean {
  const el = e.target as HTMLElement | null;
  const selector = activatingKey ? `${TYPING_TARGETS}, button, a` : TYPING_TARGETS;
  if (el?.closest(selector)) return true;
  return !!document.querySelector('[role="dialog"], [role="alertdialog"]');
}
