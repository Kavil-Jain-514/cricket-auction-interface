import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';
import { getErrorMessage } from './utils';

describe('getErrorMessage', () => {
  test('a ConvexError shows its message (what production sends)', () => {
    expect(getErrorMessage(new ConvexError('Not paid yet'))).toBe('Not paid yet');
  });

  test('a ConvexError with an object payload shows its message field', () => {
    expect(getErrorMessage(new ConvexError({ message: 'Pick a category' }))).toBe('Pick a category');
    expect(getErrorMessage(new ConvexError({ code: 42 }), 'Could not save')).toBe('Could not save');
  });

  test('strips the Convex request prefix, "Uncaught Error" and the stack (development)', () => {
    const raw =
      '[CONVEX M(registrations:approve)] [Request ID: 6f1c2d3e4f5a6b7c] Server Error\n' +
      'Uncaught Error: Rita is already a player\n' +
      '    at approveOne (../convex/registrations.ts:537:10)\n' +
      '    at async handler (../convex/registrations.ts:588:20)\n\n' +
      '  Called by client';
    expect(getErrorMessage(new Error(raw))).toBe('Rita is already a player');
  });

  test('a ConvexError seen through the dev wrapper keeps just its message', () => {
    const raw = '[CONVEX M(staff:add)] [Request ID: abc] Server Error\nUncaught ConvexError: Enter a valid email address\n    at handler (../convex/staff.ts:40:5)';
    expect(getErrorMessage(new Error(raw))).toBe('Enter a valid email address');
  });

  test('a redacted production error falls back to the caller’s message', () => {
    expect(getErrorMessage(new Error('[CONVEX M(x:y)] [Request ID: abc] Server Error'), 'Could not approve')).toBe(
      'Could not approve. Please try again.',
    );
    expect(getErrorMessage(new Error('Server Error'))).toBe('Something went wrong. Please try again.');
  });

  test('network failures say so', () => {
    expect(getErrorMessage(new TypeError('Failed to fetch'))).toMatch(/connection/i);
    expect(getErrorMessage(new Error('Connection lost while action was in flight'))).toMatch(/connection/i);
  });

  test('argument validation errors don’t leak validator dumps', () => {
    const raw =
      "[CONVEX M(tournaments:update)] [Request ID: x] Server Error\nArgumentValidationError: Value does not match validator.\nPath: .settings.basePurse\nValue: \"abc\"\nValidator: v.float64()";
    expect(getErrorMessage(new Error(raw), 'Could not save')).toBe(
      'Some of the details entered aren’t valid. Check the form and try again.',
    );
  });

  test('strings, plain objects and nothing', () => {
    expect(getErrorMessage('Plain text')).toBe('Plain text');
    expect(getErrorMessage({ message: 'From an object' })).toBe('From an object');
    expect(getErrorMessage(undefined, 'Fallback')).toBe('Fallback');
    expect(getErrorMessage(42, 'Fallback')).toBe('Fallback');
  });
});
