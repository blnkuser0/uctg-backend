import { TimeLog, ITimeLog, TimeLogType } from "../models/TimeLog.model";
import { Leave } from "../models/Leave.model";
import { User } from "../models/User.model";
import { computeClockState, isValidTransition, ClockState } from "../utils/timeLogState";
import { DaySummary, expandApprovedLeaveDays, summarizeRange } from "../utils/attendance";
import { PH_TIME_ZONE } from "../utils/phTime";
import { zonedStartOfDayForKey, zonedEndOfDay, zonedMonthRange, zonedDateKey } from "../utils/zonedTime";
import { PeriodSummary, buildPeriodSummary, summaryWindow } from "../utils/attendancePeriods";
import { PERMISSIONS } from "../constants/permissions";
import { ShiftType, shiftTimeZone } from "../constants/shift";
import { ApiError } from "../utils/ApiError";

/**
 * "Today's" clock events for state/UI purposes — but a graveyard shift that's still open
 * (timed in before midnight, no time-out yet) must stay visible after midnight rolls over, or
 * the user gets silently reset to "clocked-out" with no way to end a shift that's still actually
 * running. So: if the most recent event is an open one (anything but time-out), return that
 * whole session from its time-in onward, regardless of which day it started on; otherwise fall
 * back to the plain "events since the start of today" window, in the user's own shift timezone.
 */
async function getTodayLogs(organizationId: string, userId: string, timeZone: string): Promise<ITimeLog[]> {
  const lastLog = await TimeLog.findOne({ organizationId, userId }).sort({ timestamp: -1 });

  if (lastLog && lastLog.type !== "time-out") {
    const sessionStart = await TimeLog.findOne({
      organizationId,
      userId,
      type: "time-in",
      timestamp: { $lte: lastLog.timestamp },
    }).sort({ timestamp: -1 });

    if (sessionStart) {
      return TimeLog.find({ organizationId, userId, timestamp: { $gte: sessionStart.timestamp } }).sort({ timestamp: 1 });
    }
  }

  return TimeLog.find({
    organizationId,
    userId,
    timestamp: { $gte: zonedStartOfDayForKey(zonedDateKey(new Date(), timeZone), timeZone) },
  }).sort({ timestamp: 1 });
}

async function getTodayWithState(
  organizationId: string,
  userId: string,
  shiftType: ShiftType
): Promise<{ logs: ITimeLog[]; state: ClockState }> {
  const logs = await getTodayLogs(organizationId, userId, shiftTimeZone(shiftType));
  return { logs, state: computeClockState(logs) };
}

async function clock(
  organizationId: string,
  userId: string,
  shiftType: ShiftType,
  type: TimeLogType,
  note?: string
): Promise<{ log: ITimeLog; state: ClockState }> {
  const logs = await getTodayLogs(organizationId, userId, shiftTimeZone(shiftType));
  const currentState = computeClockState(logs);

  if (!isValidTransition(currentState, type)) {
    throw ApiError.badRequest(`Cannot record "${type}" while in state "${currentState}"`);
  }

  const log = await TimeLog.create({ organizationId, userId, type, note: note ?? null });
  const newState = computeClockState([...logs, log]);

  return { log, state: newState };
}

async function getMonthSummary(
  organizationId: string,
  userId: string,
  shiftType: ShiftType,
  year: number,
  month: number
): Promise<DaySummary[]> {
  const timeZone = shiftTimeZone(shiftType);
  const { start, end } = zonedMonthRange(year, month, timeZone);

  const [logs, approvedLeaves] = await Promise.all([
    TimeLog.find({ organizationId, userId, timestamp: { $gte: start, $lte: end } }).sort({ timestamp: 1 }),
    Leave.find({
      organizationId,
      userId,
      status: "approved",
      startDate: { $lte: end },
      endDate: { $gte: start },
    }),
  ]);

  const approvedLeaveDays = expandApprovedLeaveDays(approvedLeaves, start, end, timeZone);
  return summarizeRange(start, end, logs, approvedLeaveDays, timeZone);
}

export interface TeamDayEntry {
  userId: string;
  name: string;
  shiftType: ShiftType;
  summary: DaySummary;
}

async function getTeamDaySummary(organizationId: string, dateKey: string): Promise<TeamDayEntry[]> {
  // Wide enough to cover every shift timezone's version of this calendar date in one query —
  // each user's own [dayStart, dayEnd) window (computed per-user below) narrows it back down.
  const phStart = zonedStartOfDayForKey(dateKey, PH_TIME_ZONE);
  const phEnd = zonedEndOfDay(phStart, PH_TIME_ZONE);
  const nightStart = zonedStartOfDayForKey(dateKey, shiftTimeZone("night"));
  const nightEnd = zonedEndOfDay(nightStart, shiftTimeZone("night"));
  const windowStart = new Date(Math.min(phStart.getTime(), nightStart.getTime()));
  const windowEnd = new Date(Math.max(phEnd.getTime(), nightEnd.getTime()));

  const [users, logs, approvedLeaves] = await Promise.all([
    User.find({ organizationId, isActive: true }, { _id: 1, name: 1, shiftType: 1 }).sort({ name: 1 }),
    TimeLog.find({ organizationId, timestamp: { $gte: windowStart, $lte: windowEnd } }).sort({ timestamp: 1 }),
    Leave.find({ organizationId, status: "approved", startDate: { $lte: windowEnd }, endDate: { $gte: windowStart } }),
  ]);

  const logsByUser = new Map<string, ITimeLog[]>();
  for (const log of logs) {
    const key = log.userId.toString();
    const existing = logsByUser.get(key);
    if (existing) existing.push(log);
    else logsByUser.set(key, [log]);
  }

  const leavesByUser = new Map<string, { startDate: Date; endDate: Date }[]>();
  for (const leave of approvedLeaves) {
    const key = leave.userId.toString();
    const existing = leavesByUser.get(key);
    if (existing) existing.push(leave);
    else leavesByUser.set(key, [leave]);
  }

  return users.map((user) => {
    const userId = user._id.toString();
    const shiftType = user.shiftType ?? "morning";
    const timeZone = shiftTimeZone(shiftType);
    const dayStart = zonedStartOfDayForKey(dateKey, timeZone);
    const dayEnd = zonedEndOfDay(dayStart, timeZone);
    const leaveDays = expandApprovedLeaveDays(leavesByUser.get(userId) ?? [], dayStart, dayEnd, timeZone);
    const [summary] = summarizeRange(dayStart, dayEnd, logsByUser.get(userId) ?? [], leaveDays, timeZone);
    return { userId, name: user.name, shiftType, summary };
  });
}

export interface TeamPeriodEntry {
  userId: string;
  name: string;
  shiftType: ShiftType;
  summary: PeriodSummary;
}

async function getPeriodSummary(organizationId: string, userId: string, shiftType: ShiftType, dateKey: string): Promise<PeriodSummary> {
  const { start, end } = summaryWindow(dateKey);
  const logs = await TimeLog.find({ organizationId, userId, timestamp: { $gte: start, $lte: end } }).sort({ timestamp: 1 });
  return buildPeriodSummary(logs, dateKey, shiftTimeZone(shiftType));
}

async function getTeamPeriodSummary(organizationId: string, dateKey: string): Promise<TeamPeriodEntry[]> {
  const { start, end } = summaryWindow(dateKey);
  const [users, logs] = await Promise.all([
    User.find({ organizationId, isActive: true }, { _id: 1, name: 1, shiftType: 1 }).sort({ name: 1 }),
    TimeLog.find({ organizationId, timestamp: { $gte: start, $lte: end } }).sort({ timestamp: 1 }),
  ]);

  const logsByUser = new Map<string, ITimeLog[]>();
  for (const log of logs) {
    const key = log.userId.toString();
    const existing = logsByUser.get(key);
    if (existing) existing.push(log);
    else logsByUser.set(key, [log]);
  }

  return users.map((user) => {
    const userId = user._id.toString();
    const shiftType = user.shiftType ?? "morning";
    const timeZone = shiftTimeZone(shiftType);
    return { userId, name: user.name, shiftType, summary: buildPeriodSummary(logsByUser.get(userId) ?? [], dateKey, timeZone) };
  });
}

/**
 * Whose attendance the caller is asking about: their own by default; someone else's only with
 * ATTENDANCE_VIEW_ALL, and only within the caller's own organization.
 */
async function resolveViewedUserId(
  organizationId: string,
  requesterId: string,
  permissions: string[],
  requestedUserId?: string
): Promise<string> {
  if (!requestedUserId || requestedUserId === requesterId) return requesterId;
  if (!permissions.includes(PERMISSIONS.ATTENDANCE_VIEW_ALL)) {
    throw ApiError.forbidden("You do not have permission to view another employee's attendance");
  }
  const target = await User.findOne({ _id: requestedUserId, organizationId }, { _id: 1 });
  if (!target) throw ApiError.notFound("User not found");
  return requestedUserId;
}

/** The shiftType governing a viewed user's attendance — the requester's own when self-viewing, else looked up. */
async function resolveViewedShiftType(organizationId: string, viewedUserId: string, requesterShiftType: ShiftType, requesterId: string): Promise<ShiftType> {
  if (viewedUserId === requesterId) return requesterShiftType;
  const target = await User.findOne({ _id: viewedUserId, organizationId }, { shiftType: 1 });
  return target?.shiftType ?? "morning";
}

export const timeLogService = {
  getPeriodSummary,
  getTeamPeriodSummary,
  resolveViewedUserId,
  resolveViewedShiftType,
  getTodayWithState,
  clock,
  getMonthSummary,
  getTeamDaySummary,
};
