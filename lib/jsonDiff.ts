// lib/jsonDiff.ts
// Field-by-field before/after for an audit log row (previousData / newData).

export interface FieldDiff {
  key: string;
  /** JSON of the value, or undefined when the side doesn't have the field. */
  before: string | undefined;
  after: string | undefined;
  changed: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Every top-level key on either side, sorted, with JSON-rendered values. */
export function diffFields(previous: unknown, next: unknown): FieldDiff[] {
  const before = asRecord(previous);
  const after = asRecord(next);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys.map((key) => {
    const b = key in before ? JSON.stringify(before[key]) : undefined;
    const a = key in after ? JSON.stringify(after[key]) : undefined;
    return { key, before: b, after: a, changed: a !== b };
  });
}
