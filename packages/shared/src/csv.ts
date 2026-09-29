/**
 * CSV for Excel and Google Sheets: `;` separator (Ukrainian Excel), BOM so that
 * Cyrillic opens correctly, and a leading `= + - @` neutralized so a cell can't
 * become a formula (as in both old projects).
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: string[][]): string {
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}
