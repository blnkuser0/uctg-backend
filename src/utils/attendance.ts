import { ITimeLog } from "../models/TimeLog.model";
import { PH_TIME_ZONE } from "./phTime";
import { zonedDateKey, zonedIsWeekend, zonedAddDaysToKey, zonedStartOfDayForKey } from "./zonedTime";

export type DayAttendanceStatus = "present" | "on-leave" | "absent" | "weekend" | "upcoming";

export interface DaySummary {
  date: string; // YYYY-MM-DD, calendar day in whichever timeZone was passed to summarizeRange
  status: DayAttendanceStatus;
  firstTimeIn: Date | null;
  lastTimeOut: Date | null;
  workedMinutes: number;
  // Time spent on break (break-in -> break-out) — the 60-minute cap in BREAK_LIMIT_MINUTES applies to it.
  breakMinutes: number;
}

// Flagged red once a single break reaches this length; shown orange up to it. Matches the
// UI/UX pattern from Suprah's own Timeproof (there it's 70 minutes — Catalyst's is 60).
export const BREAK_LIMIT_MINUTES = 60;

/** Expands approved leave date ranges into the set of day keys they cover (in `timeZone`), clamped to [start, end]. */
export function expandApprovedLeaveDays(
  leaves: { startDate: Date; endDate: Date }[],
  start: Date,
  end: Date,
  timeZone: string = PH_TIME_ZONE
): Set<string> {
  const days = new Set<string>();
  for (const leave of leaves) {
    const startKey = zonedDateKey(new Date(Math.max(leave.startDate.getTime(), start.getTime())), timeZone);
    const endKey = zonedDateKey(new Date(Math.min(leave.endDate.getTime(), end.getTime())), timeZone);
    let key = startKey;
    while (key <= endKey) {
      days.add(key);
      key = zonedAddDaysToKey(key, 1);
    }
  }
  return days;
}

interface ShiftTotals {
  firstTimeIn: Date;
  lastTimeOut: Date | null;
  workedMinutes: number;
  breakMinutes: number;
}

/**
 * Groups the full clock-event stream into shifts (time-in -> time-out) and attributes each
 * shift ENTIRELY to the calendar day (in `timeZone`) its time-in fell on — its "shift date" —
 * rather than splitting it at midnight. This matters for graveyard shifts: a 9pm -> 5am PHT
 * shift must stay a single day's record (the day it started), not bleed a few hours' worth of
 * "present" status and minutes onto the following calendar day the instant midnight ticks over
 * — which would otherwise prematurely count a second cut-off day while the employee is still
 * mid-shift, and silently drop them from "today" (unable to clock out) once the date rolls over.
 * This holds regardless of which `timeZone` is used (e.g. a night-shift worker's America/New_York
 * day boundary, which a typical evening-start PHT shift never crosses in the first place) — it's
 * the safety net for any shift that crosses ITS OWN zone's midnight, whichever zone that is.
 *
 * Two shifts on the same day (a split shift) accumulate into the same record, keyed by the
 * EARLIEST time-in of the day; an open shift with no time-out yet still gets a record (present,
 * with whatever minutes have been closed out by a break so far) so it isn't silently dropped.
 */
function groupIntoShifts(logs: ITimeLog[], timeZone: string): Map<string, ShiftTotals> {
  const sorted = [...logs].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const shiftsByDate = new Map<string, ShiftTotals>();

  let shiftDateKey: string | null = null; // which day's record the currently-open shift belongs to
  let workStart: Date | null = null; // start of the current un-paused working interval
  let breakStart: Date | null = null; // start of the current break interval

  function getOrCreate(key: string, firstTimeIn: Date): ShiftTotals {
    let totals = shiftsByDate.get(key);
    if (!totals) {
      totals = { firstTimeIn, lastTimeOut: null, workedMinutes: 0, breakMinutes: 0 };
      shiftsByDate.set(key, totals);
    }
    return totals;
  }

  for (const log of sorted) {
    if (log.type === "time-in") {
      shiftDateKey = zonedDateKey(log.timestamp, timeZone);
      workStart = log.timestamp;
      getOrCreate(shiftDateKey, log.timestamp);
    } else if (log.type === "break-in" && shiftDateKey && workStart) {
      getOrCreate(shiftDateKey, workStart).workedMinutes += (log.timestamp.getTime() - workStart.getTime()) / 60000;
      workStart = null;
      breakStart = log.timestamp;
    } else if (log.type === "break-out" && shiftDateKey && breakStart) {
      getOrCreate(shiftDateKey, breakStart).breakMinutes += (log.timestamp.getTime() - breakStart.getTime()) / 60000;
      breakStart = null;
      workStart = log.timestamp;
    } else if (log.type === "time-out" && shiftDateKey && workStart) {
      const totals = getOrCreate(shiftDateKey, workStart);
      totals.workedMinutes += (log.timestamp.getTime() - workStart.getTime()) / 60000;
      totals.lastTimeOut = log.timestamp;
      shiftDateKey = null;
      workStart = null;
    }
  }

  // Round once per shift after summing every interval that touched it, rather than per-interval,
  // so multiple intervals in one shift don't compound rounding error.
  for (const totals of shiftsByDate.values()) {
    totals.workedMinutes = Math.round(totals.workedMinutes);
    totals.breakMinutes = Math.round(totals.breakMinutes);
  }

  return shiftsByDate;
}

/**
 * Builds one summary per calendar day in [start, end], filling gaps with absent/weekend/upcoming.
 * `timeZone` governs both the shift-date attribution AND the calendar grid/leave-day matching —
 * defaults to PH time; pass a night-shift worker's own zone (constants/shift.ts) for their view.
 */
export function summarizeRange(
  start: Date,
  end: Date,
  logs: ITimeLog[],
  approvedLeaveDays: Set<string> = new Set(),
  timeZone: string = PH_TIME_ZONE
): DaySummary[] {
  const shiftsByDate = groupIntoShifts(logs, timeZone);

  const todayKey = zonedDateKey(new Date(), timeZone);
  const endKey = zonedDateKey(end, timeZone);
  const summaries: DaySummary[] = [];
  let key = zonedDateKey(start, timeZone);

  while (key <= endKey) {
    const shift = shiftsByDate.get(key);

    let status: DayAttendanceStatus;
    if (shift) {
      status = "present";
    } else if (approvedLeaveDays.has(key)) {
      status = "on-leave";
    } else if (key > todayKey) {
      status = "upcoming";
    } else if (zonedIsWeekend(zonedStartOfDayForKey(key, timeZone), timeZone)) {
      status = "weekend";
    } else {
      status = "absent";
    }

    summaries.push({
      date: key,
      status,
      firstTimeIn: shift?.firstTimeIn ?? null,
      lastTimeOut: shift?.lastTimeOut ?? null,
      workedMinutes: shift?.workedMinutes ?? 0,
      breakMinutes: shift?.breakMinutes ?? 0,
    });

    key = zonedAddDaysToKey(key, 1);
  }

  return summaries;
}
