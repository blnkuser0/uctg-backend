import { TimeLog, ITimeLog, TimeLogType } from "../models/TimeLog.model";
import { Leave } from "../models/Leave.model";
import { User } from "../models/User.model";
import { computeClockState, isValidTransition, ClockState } from "../utils/timeLogState";
import { DaySummary, expandApprovedLeaveDays, summarizeRange } from "../utils/attendance";
import { phStartOfDay, phEndOfDay, phMonthRange } from "../utils/phTime";
import { ApiError } from "../utils/ApiError";

async function getTodayLogs(organizationId: string, userId: string): Promise<ITimeLog[]> {
  return TimeLog.find({
    organizationId,
    userId,
    timestamp: { $gte: phStartOfDay() },
  }).sort({ timestamp: 1 });
}

async function getTodayWithState(
  organizationId: string,
  userId: string
): Promise<{ logs: ITimeLog[]; state: ClockState }> {
  const logs = await getTodayLogs(organizationId, userId);
  return { logs, state: computeClockState(logs) };
}

async function clock(
  organizationId: string,
  userId: string,
  type: TimeLogType,
  note?: string
): Promise<{ log: ITimeLog; state: ClockState }> {
  const logs = await getTodayLogs(organizationId, userId);
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
  year: number,
  month: number
): Promise<DaySummary[]> {
  const { start, end } = phMonthRange(year, month);

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

  const approvedLeaveDays = expandApprovedLeaveDays(approvedLeaves, start, end);
  return summarizeRange(start, end, logs, approvedLeaveDays);
}

export interface TeamDayEntry {
  userId: string;
  name: string;
  summary: DaySummary;
}

async function getTeamDaySummary(organizationId: string, date: Date): Promise<TeamDayEntry[]> {
  const dayStart = phStartOfDay(date);
  const dayEnd = phEndOfDay(date);

  const [users, logs, approvedLeaves] = await Promise.all([
    User.find({ organizationId, isActive: true }, { _id: 1, name: 1 }).sort({ name: 1 }),
    TimeLog.find({ organizationId, timestamp: { $gte: dayStart, $lte: dayEnd } }).sort({ timestamp: 1 }),
    Leave.find({ organizationId, status: "approved", startDate: { $lte: dayEnd }, endDate: { $gte: dayStart } }),
  ]);

  const logsByUser = new Map<string, ITimeLog[]>();
  for (const log of logs) {
    const key = log.userId.toString();
    const existing = logsByUser.get(key);
    if (existing) existing.push(log);
    else logsByUser.set(key, [log]);
  }

  // A single day's window, so this set is either empty or just { "that one date" }.
  const leaveDayKey = expandApprovedLeaveDays(approvedLeaves, dayStart, dayEnd);
  const onLeaveUserIds = new Set(approvedLeaves.map((l) => l.userId.toString()));

  return users.map((user) => {
    const userId = user._id.toString();
    const [summary] = summarizeRange(
      dayStart,
      dayEnd,
      logsByUser.get(userId) ?? [],
      onLeaveUserIds.has(userId) ? leaveDayKey : undefined
    );
    return { userId, name: user.name, summary };
  });
}

export const timeLogService = {
  getTodayWithState,
  clock,
  getMonthSummary,
  getTeamDaySummary,
};
