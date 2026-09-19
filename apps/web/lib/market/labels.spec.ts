import { averageMinutes, releaseHint, traderRecord, untilLabel } from "./labels";

/* The words the market puts beside a name and under an ad. */

const MINUTE = 60_000;

describe("traderRecord", () => {
  it("counts orders and gives the completion rate once there is one", () => {
    expect(traderRecord({ tradesTotal: 1, completionRate: null })).toBe("1 order");
    expect(traderRecord({ tradesTotal: 312, completionRate: 99 })).toBe(
      "312 orders · 99% completion",
    );
  });
});

describe("releaseHint and averageMinutes", () => {
  it("round to the minute, never below one, and say nothing before there is an average", () => {
    expect(releaseHint({ avgReleaseSeconds: 240 })).toBe("releases in ~4 min");
    expect(releaseHint({ avgReleaseSeconds: 10 })).toBe("releases in ~1 min");
    expect(releaseHint({ avgReleaseSeconds: null })).toBeNull();
    expect(averageMinutes(600)).toBe("~10 min");
    expect(averageMinutes(null)).toBe("—");
  });
});

describe("untilLabel", () => {
  it("counts down in hours and minutes, rounding up", () => {
    expect(untilLabel(23 * 60 * MINUTE + 41 * MINUTE)).toBe("23 h 41 min");
    expect(untilLabel(2 * 60 * MINUTE)).toBe("2 h");
    expect(untilLabel(41 * MINUTE)).toBe("41 min");
    expect(untilLabel(30_000)).toBe("1 min");
  });

  it("says so when the moment has come", () => {
    expect(untilLabel(0)).toBe("less than a minute");
    expect(untilLabel(-5 * MINUTE)).toBe("less than a minute");
  });
});
