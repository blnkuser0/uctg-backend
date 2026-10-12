// Generic IANA-timezone date-key math, usable for any zone — including ones that observe DST
// (e.g. America/New_York), unlike phTime.ts's fixed-offset arithmetic which only works because
// Asia/Manila never observes DST. Built on Intl.DateTimeFormat so it needs no extra dependency
// and always reflects the ICU tzdata the Node runtime ships with.

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC-vs-`timeZone` offset (ms) in effect at `date` — positive when the zone is ahead of UTC. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  // Reading the zone's local wall-clock fields back as if they were UTC gives the instant whose
  // true UTC value is offset from `date` by exactly the zone's current UTC offset.
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - date.getTime();
}

/** "YYYY-MM-DD" for the calendar day `date` falls on in `timeZone`. */
export function zonedDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
    date
  );
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The UTC instant of local midnight for the "YYYY-MM-DD" calendar day `dateKey` in `timeZone`. */
export function zonedStartOfDayForKey(dateKey: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const naiveUtcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  // DST transitions always land at 2am local (never at midnight), so the offset sampled at this
  // day's own midnight is unambiguous and correct even on a transition day.
  const offset = zoneOffsetMs(new Date(naiveUtcMidnight), timeZone);
  return new Date(naiveUtcMidnight - offset);
}

/** The UTC instant of local midnight for the calendar day `date` falls on in `timeZone`. */
export function zonedStartOfDay(date: Date, timeZone: string): Date {
  return zonedStartOfDayForKey(zonedDateKey(date, timeZone), timeZone);
}

/** Adds whole calendar days to a "YYYY-MM-DD" key via pure date-string arithmetic (DST-safe,
 *  since it never does millisecond math across a day that might be 23 or 25 hours long). */
export function zonedAddDaysToKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`;
}

/** The last millisecond of the calendar day `date` falls on in `timeZone`. */
export function zonedEndOfDay(date: Date, timeZone: string): Date {
  const nextKey = zonedAddDaysToKey(zonedDateKey(date, timeZone), 1);
  return new Date(zonedStartOfDayForKey(nextKey, timeZone).getTime() - 1);
}

/** Whether `date` falls on a Saturday/Sunday in `timeZone`. Weekday is a pure calendar property
 *  (not time-of-day-dependent), so this is safe to compute from the date key alone. */
export function zonedIsWeekend(date: Date, timeZone: string): boolean {
  const [year, month, day] = zonedDateKey(date, timeZone).split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** [start, end] covering the whole calendar month in `timeZone`, as UTC instants. */
export function zonedMonthRange(year: number, month: number, timeZone: string): { start: Date; end: Date } {
  const startKey = `${year}-${String(month).padStart(2, "0")}-01`;
  const start = zonedStartOfDayForKey(startKey, timeZone);
  const nextMonthKey = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const end = new Date(zonedStartOfDayForKey(nextMonthKey, timeZone).getTime() - 1);
  return { start, end };
}

/** Parses a "YYYY-MM-DD" string as that calendar day's midnight in `timeZone`. */
export function parseZonedDateKey(dateKey: string, timeZone: string): Date {
  return zonedStartOfDayForKey(dateKey, timeZone);
}

export { DAY_MS };
