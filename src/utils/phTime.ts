// Asia/Manila is a fixed UTC+8 offset year-round (no DST), so day-boundary math
// can use plain millisecond arithmetic instead of a timezone library. This makes
// "today"/day-boundary logic (Timeproof, Attendance) correct regardless of what
// timezone the server process itself happens to run in.
const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC instant of PH midnight on the calendar day that `date` falls on, in PH time. */
export function phStartOfDay(date: Date = new Date()): Date {
  const shifted = new Date(date.getTime() + PH_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - PH_OFFSET_MS);
}

/** The last millisecond of the PH calendar day that `date` falls on. */
export function phEndOfDay(date: Date = new Date()): Date {
  return new Date(phStartOfDay(date).getTime() + DAY_MS - 1);
}

/** "YYYY-MM-DD" for the PH calendar day that `date` falls on. */
export function phDateKey(date: Date): string {
  const shifted = new Date(date.getTime() + PH_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Whether `date` falls on a Saturday/Sunday in PH time. */
export function phIsWeekend(date: Date): boolean {
  const shifted = new Date(date.getTime() + PH_OFFSET_MS);
  const day = shifted.getUTCDay();
  return day === 0 || day === 6;
}

/** Adds whole days via fixed-length arithmetic — safe since PH never observes DST. */
export function phAddDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** [start, end] covering the whole PH calendar month, as UTC instants. */
export function phMonthRange(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1) - PH_OFFSET_MS);
  const nextMonthStart = new Date(Date.UTC(year, month, 1) - PH_OFFSET_MS);
  return { start, end: new Date(nextMonthStart.getTime() - 1) };
}

/** Parses a "YYYY-MM-DD" string as that calendar day in PH time. */
export function parsePhDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) - PH_OFFSET_MS);
}
