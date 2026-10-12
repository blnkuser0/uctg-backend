import { zonedDateKey, zonedStartOfDayForKey, zonedAddDaysToKey, zonedIsWeekend, zonedMonthRange } from "../src/utils/zonedTime";

describe("zonedTime (generic, DST-aware timezone math)", () => {
  it("computes different UTC offsets for EST (winter) vs EDT (summer) in America/New_York", () => {
    // Same UTC hour-of-day, different season — EST is UTC-5, EDT is UTC-4, so the local
    // calendar date these instants fall on differs by the DST offset.
    const winterInstant = new Date(Date.UTC(2026, 0, 15, 4, 30)); // Jan 15, 04:30 UTC
    const summerInstant = new Date(Date.UTC(2026, 6, 15, 4, 30)); // Jul 15, 04:30 UTC
    expect(zonedDateKey(winterInstant, "America/New_York")).toBe("2026-01-14"); // EST: UTC-5 -> 23:30 Jan 14
    expect(zonedDateKey(summerInstant, "America/New_York")).toBe("2026-07-15"); // EDT: UTC-4 -> 00:30 Jul 15
  });

  it("treats the spring-forward transition day as 23 hours long, not 24", () => {
    let shortDayFound = false;
    let cursorKey = "2026-03-01";
    for (let i = 0; i < 31; i++) {
      const nextKey = zonedAddDaysToKey(cursorKey, 1);
      const durationMs =
        zonedStartOfDayForKey(nextKey, "America/New_York").getTime() - zonedStartOfDayForKey(cursorKey, "America/New_York").getTime();
      if (durationMs === 23 * 60 * 60 * 1000) shortDayFound = true;
      cursorKey = nextKey;
    }
    expect(shortDayFound).toBe(true);
  });

  it("treats the fall-back transition day as 25 hours long, not 24", () => {
    let longDayFound = false;
    let cursorKey = "2026-11-01";
    for (let i = 0; i < 30; i++) {
      const nextKey = zonedAddDaysToKey(cursorKey, 1);
      const durationMs =
        zonedStartOfDayForKey(nextKey, "America/New_York").getTime() - zonedStartOfDayForKey(cursorKey, "America/New_York").getTime();
      if (durationMs === 25 * 60 * 60 * 1000) longDayFound = true;
      cursorKey = nextKey;
    }
    expect(longDayFound).toBe(true);
  });

  it("Asia/Manila never has a DST-shortened/lengthened day (fixed UTC+8 year-round)", () => {
    let cursorKey = "2026-03-01";
    for (let i = 0; i < 31; i++) {
      const nextKey = zonedAddDaysToKey(cursorKey, 1);
      const durationMs = zonedStartOfDayForKey(nextKey, "Asia/Manila").getTime() - zonedStartOfDayForKey(cursorKey, "Asia/Manila").getTime();
      expect(durationMs).toBe(24 * 60 * 60 * 1000);
      cursorKey = nextKey;
    }
  });

  it("zonedMonthRange covers exactly the calendar month, DST transition inside it notwithstanding", () => {
    const { start, end } = zonedMonthRange(2026, 3, "America/New_York");
    expect(zonedDateKey(start, "America/New_York")).toBe("2026-03-01");
    expect(zonedDateKey(end, "America/New_York")).toBe("2026-03-31");
  });

  it("zonedIsWeekend is unaffected by DST — weekday is a pure calendar property", () => {
    const instant = new Date(Date.UTC(2026, 2, 8, 12, 0));
    expect(zonedIsWeekend(instant, "America/New_York")).toBe(zonedIsWeekend(instant, "Asia/Manila"));
  });
});
