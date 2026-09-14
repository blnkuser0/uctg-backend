import { ITimeLog } from "../models/TimeLog.model";
import { phDateKey, phIsWeekend, phStartOfDay, phEndOfDay, phAddDays } from "./phTime";

export type DayAttendanceStatus = "present" | "on-leave" | "absent" | "weekend" | "upcoming";

export interface DaySummary {
  date: string; // YYYY-MM-DD, PH calendar day
  status: DayAttendanceStatus;
  firstTimeIn: Date | null;
  lastTimeOut: Date | null;
  workedMinutes: number;
}

/** Expands approved leave date ranges into the set of PH-day keys they cover, clamped to [start, end]. */
export function expandApprovedLeaveDays(
  leaves: { startDate: Date; endDate: Date }[],
  start: Date,
  end: Date
): Set<string> {
  const days = new Set<string>();
  for (const leave of leaves) {
    let cursor = phStartOfDay(new Date(Math.max(leave.startDate.getTime(), start.getTime())));
    const leaveEnd = new Date(Math.min(leave.endDate.getTime(), end.getTime()));
    while (cursor <= leaveEnd) {
      days.add(phDateKey(cursor));
      cursor = phAddDays(cursor, 1);
    }
  }
  return days;
}

/**
 * Adds a worked interval [start, end) to the running per-PH-day minute totals,
 * splitting it at PH midnight if the interval crosses a day boundary (e.g. a
 * shift that clocks out shortly after midnight PH time) so minutes land on
 * the correct calendar day(s) instead of vanishing from whichever day the
 * interval doesn't fully fit into.
 */
function accumulateInterval(minutesByDay: Map<string, number>, start: Date, end: Date): void {
  let cursor = start;
  while (cursor < end) {
    const nextDayStart = new Date(phEndOfDay(cursor).getTime() + 1);
    const segmentEnd = end < nextDayStart ? end : nextDayStart;
    const key = phDateKey(cursor);
    minutesByDay.set(key, (minutesByDay.get(key) ?? 0) + (segmentEnd.getTime() - cursor.getTime()) / 60000);
    cursor = segmentEnd;
  }
}

/**
 * Reconstructs worked minutes per PH calendar day from the full clock-event
 * stream (time-in/break/lunch pairs), pairing chronologically across the
 * whole log set rather than per-day buckets — a bucket-first pairing would
 * silently drop minutes for any session whose start/stop events land in
 * different PH-day buckets (e.g. a graveyard shift, or simply because the
 * events were recorded from a server/client in a different timezone).
 */
function computeMinutesByDay(logs: ITimeLog[]): Map<string, number> {
  const sorted = [...logs].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const minutesByDay = new Map<string, number>();
  let workStart: Date | null = null;

  for (const log of sorted) {
    if (log.type === "time-in" || log.type === "break-out" || log.type === "lunch-out") {
      workStart = log.timestamp;
    } else if ((log.type === "break-in" || log.type === "lunch-in" || log.type === "time-out") && workStart) {
      accumulateInterval(minutesByDay, workStart, log.timestamp);
      workStart = null;
    }
  }

  // Round once per day after summing every session that touched it, rather
  // than per-interval, so multiple sessions in one day don't compound
  // rounding error.
  for (const [key, minutes] of minutesByDay) minutesByDay.set(key, Math.round(minutes));

  return minutesByDay;
}

/** Builds one summary per PH calendar day in [start, end], filling gaps with absent/weekend/upcoming. */
export function summarizeRange(
  start: Date,
  end: Date,
  logs: ITimeLog[],
  approvedLeaveDays: Set<string> = new Set()
): DaySummary[] {
  const byDay = new Map<string, ITimeLog[]>();
  for (const log of logs) {
    const key = phDateKey(log.timestamp);
    const existing = byDay.get(key);
    if (existing) existing.push(log);
    else byDay.set(key, [log]);
  }
  const minutesByDay = computeMinutesByDay(logs);

  const today = phDateKey(new Date());
  const summaries: DaySummary[] = [];
  let cursor = phStartOfDay(start);

  while (cursor <= end) {
    const key = phDateKey(cursor);
    const dayLogs = (byDay.get(key) ?? []).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const timeIns = dayLogs.filter((l) => l.type === "time-in");
    const timeOuts = dayLogs.filter((l) => l.type === "time-out");

    let status: DayAttendanceStatus;
    if (dayLogs.length > 0) {
      status = "present";
    } else if (approvedLeaveDays.has(key)) {
      status = "on-leave";
    } else if (key > today) {
      status = "upcoming";
    } else if (phIsWeekend(cursor)) {
      status = "weekend";
    } else {
      status = "absent";
    }

    summaries.push({
      date: key,
      status,
      firstTimeIn: timeIns[0]?.timestamp ?? null,
      lastTimeOut: timeOuts[timeOuts.length - 1]?.timestamp ?? null,
      workedMinutes: Math.round(minutesByDay.get(key) ?? 0),
    });

    cursor = phAddDays(cursor, 1);
  }

  return summaries;
}
