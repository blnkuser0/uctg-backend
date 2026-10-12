import {
  zonedDateKey,
  zonedStartOfDay,
  zonedStartOfDayForKey,
  zonedEndOfDay,
  zonedIsWeekend,
  zonedAddDaysToKey,
  zonedMonthRange,
  parseZonedDateKey,
  DAY_MS,
} from "./zonedTime";

// Asia/Manila is a fixed UTC+8 offset year-round (no DST). These are now thin wrappers around
// the generic, DST-aware zonedTime helpers (used for other timezones, e.g. night-shift workers'
// America/New_York) — behavior here is unchanged, just implemented once instead of twice.
export const PH_TIME_ZONE = "Asia/Manila";

/** The UTC instant of PH midnight on the calendar day that `date` falls on, in PH time. */
export function phStartOfDay(date: Date = new Date()): Date {
  return zonedStartOfDay(date, PH_TIME_ZONE);
}

/** The last millisecond of the PH calendar day that `date` falls on. */
export function phEndOfDay(date: Date = new Date()): Date {
  return zonedEndOfDay(date, PH_TIME_ZONE);
}

/** "YYYY-MM-DD" for the PH calendar day that `date` falls on. */
export function phDateKey(date: Date): string {
  return zonedDateKey(date, PH_TIME_ZONE);
}

/** Whether `date` falls on a Saturday/Sunday in PH time. */
export function phIsWeekend(date: Date): boolean {
  return zonedIsWeekend(date, PH_TIME_ZONE);
}

/** Adds whole days via fixed-length arithmetic — safe since PH never observes DST. */
export function phAddDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** [start, end] covering the whole PH calendar month, as UTC instants. */
export function phMonthRange(year: number, month: number): { start: Date; end: Date } {
  return zonedMonthRange(year, month, PH_TIME_ZONE);
}

/** Parses a "YYYY-MM-DD" string as that calendar day in PH time. */
export function parsePhDateKey(dateKey: string): Date {
  return parseZonedDateKey(dateKey, PH_TIME_ZONE);
}

export { zonedStartOfDayForKey, zonedAddDaysToKey };
