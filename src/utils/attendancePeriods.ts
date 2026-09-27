import { ITimeLog } from "../models/TimeLog.model";
import { DaySummary, summarizeRange } from "./attendance";
import { parsePhDateKey, phEndOfDay } from "./phTime";

// Pure "YYYY-MM-DD" calendar math (UTC-based on purpose): a date key is a calendar label, not an
// instant, so day-of-week / month-length math on it needs no timezone handling at all.
function keyToUtc(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function utcToKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDaysToKey(key: string, days: number): string {
  const date = keyToUtc(key);
  date.setUTCDate(date.getUTCDate() + days);
  return utcToKey(date);
}

export interface PeriodRange {
  from: string;
  to: string;
}

/** The Monday–Sunday week that contains the given PH date key. */
export function weekRange(dateKey: string): PeriodRange {
  const dayOfWeek = keyToUtc(dateKey).getUTCDay(); // 0 = Sunday
  const mondayOffset = (dayOfWeek + 6) % 7;
  const from = addDaysToKey(dateKey, -mondayOffset);
  return { from, to: addDaysToKey(from, 6) };
}

/**
 * The payroll cut-off containing the given date: semi-monthly — the 1st–15th, or the 16th through
 * the last day of the month. (If the company's cut-offs ever differ, this is the one place to change.)
 */
export function cutoffRange(dateKey: string): PeriodRange {
  const [year, month, day] = dateKey.split("-").map(Number);
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  if (day <= 15) return { from: `${prefix}-01`, to: `${prefix}-15` };
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${prefix}-16`, to: `${prefix}-${String(lastDay).padStart(2, "0")}` };
}

export interface PeriodStats extends PeriodRange {
  totalMinutes: number;
  daysPresent: number;
}

export interface PeriodSummary {
  week: PeriodStats;
  cutoff: PeriodStats;
}

/** The full span of instants a summary for this date needs logs for (week ∪ cut-off). */
export function summaryWindow(dateKey: string): { start: Date; end: Date } {
  const week = weekRange(dateKey);
  const cutoff = cutoffRange(dateKey);
  const from = week.from < cutoff.from ? week.from : cutoff.from;
  const to = week.to > cutoff.to ? week.to : cutoff.to;
  return { start: parsePhDateKey(from), end: phEndOfDay(parsePhDateKey(to)) };
}

function statsFor(summaries: DaySummary[], range: PeriodRange): PeriodStats {
  const inRange = summaries.filter((s) => s.date >= range.from && s.date <= range.to);
  return {
    ...range,
    totalMinutes: inRange.reduce((sum, s) => sum + s.workedMinutes, 0),
    daysPresent: inRange.filter((s) => s.status === "present").length,
  };
}

/** Week + cut-off totals for one person, from their raw clock events covering `summaryWindow`. */
export function buildPeriodSummary(logs: ITimeLog[], dateKey: string): PeriodSummary {
  const { start, end } = summaryWindow(dateKey);
  const summaries = summarizeRange(start, end, logs);
  return { week: statsFor(summaries, weekRange(dateKey)), cutoff: statsFor(summaries, cutoffRange(dateKey)) };
}
