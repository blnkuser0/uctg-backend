import { TimeLogType } from "../models/TimeLog.model";

export const CLOCK_STATES = ["clocked-out", "working", "on-break"] as const;
export type ClockState = (typeof CLOCK_STATES)[number];

interface TimeLogLike {
  type: TimeLogType;
  timestamp: Date | string;
}

/** State derived from the most recent event of the day. No events = clocked-out. */
export function computeClockState(logsSortedByTimestamp: TimeLogLike[]): ClockState {
  if (logsSortedByTimestamp.length === 0) return "clocked-out";
  const last = logsSortedByTimestamp[logsSortedByTimestamp.length - 1].type;

  switch (last) {
    case "time-out":
      return "clocked-out";
    case "break-in":
      return "on-break";
    case "time-in":
    case "break-out":
      return "working";
  }
}

const VALID_NEXT_TYPES: Record<ClockState, TimeLogType[]> = {
  "clocked-out": ["time-in"],
  working: ["break-in", "time-out"],
  "on-break": ["break-out"],
};

export function isValidTransition(currentState: ClockState, requestedType: TimeLogType): boolean {
  return VALID_NEXT_TYPES[currentState].includes(requestedType);
}
