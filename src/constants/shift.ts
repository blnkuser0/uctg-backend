// Which timezone governs a user's "calendar day" for clock-in/out and attendance purposes.
// Morning-shift employees work PH business hours, so PH midnight is the right day boundary for
// them. Night-shift employees work hours aligned to a US client's business day, so their actual
// working hours (e.g. 9pm-5am PHT) sit entirely within a single America/New_York calendar day —
// using EST/EDT as their day boundary means their shift never crosses it, which is what the
// senior dev's "EST for night shift" guidance is getting at. The shift-date grouping in
// attendance.ts (attributing a whole shift to the day its time-in fell on) stays in place as a
// safety net regardless of which zone is used, in case a shift ever starts at an unusual hour
// that crosses even that zone's midnight.
export const SHIFT_TYPES = ["morning", "night"] as const;
export type ShiftType = (typeof SHIFT_TYPES)[number];

export const SHIFT_TIME_ZONE: Record<ShiftType, string> = {
  morning: "Asia/Manila",
  night: "America/New_York",
};

export function shiftTimeZone(shiftType: ShiftType): string {
  return SHIFT_TIME_ZONE[shiftType];
}
