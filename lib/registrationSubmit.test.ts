import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';
import { afterSubmitFailure, personKey } from './registrationSubmit';

const ravi = personKey('  Ravi Kumar ', '+91 98765-43210');
const dup = () => new ConvexError('Ravi Kumar is already registered for this tournament');
const busy = () => new ConvexError('Too many registrations right now. Try again in a minute.');
const network = () => new Error('Failed to fetch');

describe('personKey', () => {
  test('matches the server: trimmed lower-case name, last 10 digits of the phone', () => {
    expect(ravi).toBe(personKey('ravi kumar', '9876543210'));
    expect(ravi).not.toBe(personKey('Ravi Kumar', '9876543211'));
  });
});

describe('afterSubmitFailure', () => {
  test('first attempt answered "already registered": the normal duplicate error', () => {
    expect(afterSubmitFailure(null, ravi, dup())).toEqual({ show: 'error', message: 'Ravi Kumar is already registered for this tournament', ambiguousFor: null });
  });

  test('after an ambiguous failure for the same person, "already registered" means it was saved', () => {
    const first = afterSubmitFailure(null, ravi, network());
    expect(first.show).toBe('error');
    expect(first.ambiguousFor).toBe(ravi);
    expect(afterSubmitFailure(first.ambiguousFor, ravi, dup())).toEqual({ show: 'saved', ambiguousFor: null });
  });

  test('busy refusals are definite answers: they never make a later duplicate a success', () => {
    let state: string | null = null;
    for (let i = 0; i < 3; i++) state = afterSubmitFailure(state, ravi, busy()).ambiguousFor;
    expect(state).toBeNull();
    expect(afterSubmitFailure(state, ravi, dup()).show).toBe('error');
  });

  test('an ambiguous failure for someone else does not count', () => {
    const other = personKey('Someone Else', '9123456780');
    expect(afterSubmitFailure(other, ravi, dup()).show).toBe('error');
  });

  test('a definite answer after an ambiguous failure keeps the flag for that person', () => {
    const state = afterSubmitFailure(ravi, ravi, new ConvexError('Age must be between 5 and 80'));
    expect(state).toMatchObject({ show: 'error', ambiguousFor: ravi });
  });
});
