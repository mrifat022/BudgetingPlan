const MONTHS = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

export function periodIdFromDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    '0',
  )}`;
}

export function periodParts(periodId: string) {
  const [year, month] = periodId.split('-').map(Number);
  return { year, month };
}

export function previousPeriodId(periodId: string): string {
  const { year, month } = periodParts(periodId);
  const previousDate = new Date(year, month - 2, 1);

  return `${previousDate.getFullYear()}-${String(
    previousDate.getMonth() + 1,
  ).padStart(2, '0')}`;
}

export function periodLabel(periodId: string): string {
  const { year, month } = periodParts(periodId);
  return `${MONTHS[month - 1] ?? ''} ${year}`.trim();
}

export function todayISO(): string {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}
