// lib/registrationSubmit.ts - What the public registration form does when a
// submit fails (app/(app)/register/[tournamentId]/page.tsx).
//
// A ConvexError is the server's definite answer: nothing was saved (busy
// refusals included, which are thrown before any write). Anything else (a
// dropped connection, a timeout, a redacted server error) is ambiguous: the
// entry may have been saved and only the answer lost. Only after such an
// ambiguous failure for the same person does a later "already registered"
// mean "your earlier try worked". A first-attempt "already registered" is
// someone else's entry (or theirs from another day) and stays an error.
//
// The server also hands the registration back outright when the same browser
// (device id) submits the same person again. This rule covers the rest: an
// earlier entry the server can't tie to this browser's id.
import { ConvexError } from 'convex/values';
import { getErrorMessage } from './utils';

/** The server's duplicate key: trimmed lower-case name, the phone's last 10 digits. */
export function personKey(name: string, phone: string): string {
  return `${name.trim().toLowerCase()}|${phone.replace(/\D/g, '').slice(-10)}`;
}

const ALREADY_REGISTERED = /is already registered for this tournament$/;

export type FailureOutcome =
  | { show: 'saved'; ambiguousFor: null }
  | { show: 'error'; message: string; ambiguousFor: string | null };

/**
 * Decide what to show after a failed submit for `person`. `ambiguousFor` is
 * the person whose earlier submit in this form session ended ambiguously
 * (or null); the result carries its next value.
 */
export function afterSubmitFailure(ambiguousFor: string | null, person: string, error: unknown): FailureOutcome {
  const message = getErrorMessage(error, 'Could not register');
  const definite = error instanceof ConvexError;
  if (definite && ambiguousFor === person && ALREADY_REGISTERED.test(message)) {
    return { show: 'saved', ambiguousFor: null };
  }
  // A definite answer doesn't settle an earlier ambiguous try for this person:
  // it may still have been saved, so the flag stays.
  return { show: 'error', message, ambiguousFor: definite ? ambiguousFor : person };
}
