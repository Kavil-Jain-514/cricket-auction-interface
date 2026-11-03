// lib/registrationsWorkbook.ts
// Custom-question answers for display and the "Export registrations (.xlsx)"
// sheet. Pure (rows only) so it is unit-testable; the page turns the rows
// into a workbook with the xlsx package, as resultsWorkbook does.
import type { AnswerValue, QuestionType } from '@/convex/registrationForm';
import { formatAmount } from '@/lib/amount';
import { getRoleDisplay } from '@/lib/utils';

export type QuestionLabels = Record<string, { label: string; type: QuestionType; archived: boolean }>;

/** One answer as text: amounts grouped, choices joined, dates as written. */
export function formatAnswer(value: AnswerValue, type: QuestionType | undefined): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'number') return type === 'amount' ? `₹${formatAmount(value)}` : String(value);
  return value;
}

export interface RegistrationRow {
  name: string;
  phoneNumber: string;
  age: number;
  role: string[];
  battingBowlingHand: string;
  status: string;
  fee: number;
  createdAt: number;
  answers?: { values: Array<{ questionId: string; value: AnswerValue }> };
}

/**
 * Header plus one row per registration. Every question ever answered gets a
 * column (current ones first, archived after), so old answers aren't lost.
 */
export function buildRegistrationRows(rows: RegistrationRow[], labels: QuestionLabels): Array<Array<string | number>> {
  const answered = new Set(rows.flatMap((r) => r.answers?.values.map((a) => a.questionId) ?? []));
  const ids = Object.keys(labels)
    .filter((id) => !labels[id].archived || answered.has(id))
    .sort((a, b) => Number(labels[a].archived) - Number(labels[b].archived));
  const header = [
    'Name', 'Mobile', 'Age', 'Role', 'Hand', 'Status', 'Fee (₹)', 'Registered',
    ...ids.map((id) => (labels[id].archived ? `${labels[id].label} (archived)` : labels[id].label)),
  ];
  const body = rows.map((r) => {
    const byId = new Map(r.answers?.values.map((a) => [a.questionId, a.value]) ?? []);
    return [
      r.name,
      r.phoneNumber,
      r.age,
      getRoleDisplay(r.role),
      r.battingBowlingHand,
      r.status,
      r.fee,
      new Date(r.createdAt).toISOString().slice(0, 10),
      ...ids.map((id) => {
        const value = byId.get(id);
        // Numbers stay numbers so the sheet can sum them.
        if (typeof value === 'number') return value;
        return value === undefined ? '' : formatAnswer(value, labels[id].type);
      }),
    ];
  });
  return [header, ...body];
}
