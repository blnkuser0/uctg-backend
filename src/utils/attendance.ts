import { ITimeLog } from "../models/TimeLog.model";
import { phDateKey, phIsWeekend, phStartOfDay, phAddDays } from "./phTime";

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

/** Reconstructs worked intervals from the clock-event stream (time-in/break/lunch pairs). */
function computeWorkedMinutes(logsForDay: ITimeLog[]): number {
  let workedMs = 0;
  let workStart: Date | null = null;

  for (const log of logsForDay) {
    if (log.type === "time-in" || log.type === "break-out" || log.type === "lunch-out") {
      workStart = log.timestamp;
    } else if ((log.type === "break-in" || log.type === "lunch-in" || log.type === "time-out") && workStart) {
      workedMs += log.timestamp.getTime() - workStart.getTime();
      workStart = null;
    }
  }

  return Math.round(workedMs / 60000);
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
      workedMinutes: computeWorkedMinutes(dayLogs),
    });

    cursor = phAddDays(cursor, 1);
  }

  return summaries;
}
