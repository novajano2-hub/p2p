import { presenceLabel } from "./presence";

/* The words beside the online dot, from minutes to the date. */

const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const ago = (ms: number) => ({ online: false, lastSeenAt: new Date(NOW - ms).toISOString() });
const MINUTE = 60_000;

describe("presenceLabel", () => {
  it("says Online when the server says so, whatever the time", () => {
    expect(presenceLabel({ online: true, lastSeenAt: null }, NOW)).toBe("Online");
    expect(presenceLabel({ online: true, lastSeenAt: new Date(NOW).toISOString() }, NOW)).toBe(
      "Online",
    );
  });

  it("says nothing about someone never seen", () => {
    expect(presenceLabel({ online: false, lastSeenAt: null }, NOW)).toBeNull();
    expect(presenceLabel({ online: false, lastSeenAt: "not a time" }, NOW)).toBeNull();
  });

  it("counts minutes, then hours, then days", () => {
    expect(presenceLabel(ago(20_000), NOW)).toBe("Last online 1 min ago");
    expect(presenceLabel(ago(25 * MINUTE), NOW)).toBe("Last online 25 min ago");
    expect(presenceLabel(ago(59 * MINUTE), NOW)).toBe("Last online 59 min ago");
    expect(presenceLabel(ago(60 * MINUTE), NOW)).toBe("Last online 1 h ago");
    expect(presenceLabel(ago(23 * 60 * MINUTE), NOW)).toBe("Last online 23 h ago");
    expect(presenceLabel(ago(24 * 60 * MINUTE), NOW)).toBe("Last online 1 day ago");
    expect(presenceLabel(ago(6 * 24 * 60 * MINUTE), NOW)).toBe("Last online 6 days ago");
  });

  it("gives the date after a week", () => {
    expect(presenceLabel(ago(10 * 24 * 60 * MINUTE), NOW)).toBe("Last online on 8 Sept");
  });
});
