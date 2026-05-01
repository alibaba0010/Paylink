export function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";

  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

export function toCsv(
  headers: string[],
  rows: Array<Array<unknown>>,
): string {
  const lines = [headers.map(escapeCsv).join(",")];

  for (const row of rows) {
    lines.push(row.map(escapeCsv).join(","));
  }

  return `${lines.join("\n")}\n`;
}
