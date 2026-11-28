// lib/registrationsWorkbook.ts
// Custom-question answers for display and the "Export registrations (.xlsx)"
// sheet. Pure (rows only) so it is unit-testable; the page turns the rows
// into a workbook with the xlsx package, as resultsWorkbook does.
import type { AnswerValue, QuestionType } from '@/convex/registrationForm';
import { formatAmount } from '@/lib/amount';
import { formatSaleTime } from '@/lib/resultsWorkbook';
import { getRoleDisplay } from '@/lib/utils';
import { coupleCells, coupleColumns, type CoupleFields } from '@/lib/couple';

export type QuestionLabels = Record<string, { label: string; type: QuestionType; archived: boolean }>;

/** One answer as text: amounts grouped, choices joined, dates as written. */
export function formatAnswer(value: AnswerValue, type: QuestionType | undefined): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'number') return type === 'amount' ? `₹${formatAmount(value)}` : String(value);
  return value;
}

export interface RegistrationRow extends CoupleFields {
  name: string;
  phoneNumber: string;
  age?: number;
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
 * Couple tournaments add the entry and female-member columns after
 * Hand; standard sheets are unchanged.
 */
export function buildRegistrationRows(
  rows: RegistrationRow[],
  labels: QuestionLabels,
  opts: { couple?: boolean } = {},
): Array<Array<string | number>> {
  const answered = new Set(rows.flatMap((r) => r.answers?.values.map((a) => a.questionId) ?? []));
  const ids = Object.keys(labels)
    .filter((id) => !labels[id].archived || answered.has(id))
    .sort((a, b) => Number(labels[a].archived) - Number(labels[b].archived));
  const header = [
    'Name', 'Mobile', 'Age', 'Role', 'Hand',
    ...(opts.couple ? coupleColumns(true) : []),
    'Status', 'Fee (₹)', 'Registered (IST)',
    ...ids.map((id) => (labels[id].archived ? `${labels[id].label} (archived)` : labels[id].label)),
  ];
  const body = rows.map((r) => {
    const byId = new Map(r.answers?.values.map((a) => [a.questionId, a.value]) ?? []);
    return [
      r.name,
      r.phoneNumber,
      r.age ?? "",
      getRoleDisplay(r.role),
      r.battingBowlingHand,
      ...(opts.couple ? coupleCells(r, true) : []),
      r.status,
      r.fee,
      formatSaleTime(r.createdAt),
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

export type RegisteredOrder = 'newest' | 'oldest';

/** A sorted copy by submission time; the input is left as it is. */
export function sortByRegistered<T extends { createdAt: number }>(rows: T[], order: RegisteredOrder): T[] {
  const sign = order === 'newest' ? -1 : 1;
  return [...rows].sort((a, b) => sign * (a.createdAt - b.createdAt));
}
