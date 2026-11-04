// lib/csv.ts - Rows to RFC 4180 CSV for downloads opened in Excel or Sheets.

/** Cells a spreadsheet would run as a formula; prefixed with ' to show as text. */
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: string | undefined): string {
  const text = value === undefined ? "" : FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: Array<Array<string | undefined>>): string {
  return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}
