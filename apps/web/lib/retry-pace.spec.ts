import { noteRetry, resetRetryPace, retryDelay } from "./retry-pace";

/* How often a failed screen asks again by itself. */

describe("the pace of automatic retries", () => {
  beforeEach(resetRetryPace);

  it("asks soon the first time, then less and less often, and settles", () => {
    let now = 1_000_000;
    const waits: number[] = [];
    for (let i = 0; i < 9; i++) {
      const wait = retryDelay(now, 0.5);
      waits.push(wait);
      now += wait;
      noteRetry(now);
    }
    expect(waits).toEqual([2_000, 3_000, 5_000, 8_000, 13_000, 20_000, 30_000, 30_000, 30_000]);
    // Seven asks in the first minute of an outage, however many tabs are open: not a hammering.
    expect(waits.slice(0, 6).reduce((sum, wait) => sum + wait, 0)).toBeLessThan(60_000);
  });

  it("counts panels that failed together as one round", () => {
    const now = 1_000_000;
    // Three panels on one page ask again within the same moment.
    noteRetry(now);
    noteRetry(now + 5);
    noteRetry(now + 40);
    expect(retryDelay(now + 50, 0.5)).toBe(3_000);
  });

  it("keeps its place across a screen that fails again at once", () => {
    let now = 1_000_000;
    for (let i = 0; i < 3; i++) {
      now += retryDelay(now, 0.5);
      noteRetry(now);
    }
    // The error that mounts afresh after a failed retry does not start from the first step.
    expect(retryDelay(now + 200, 0.5)).toBe(8_000);
  });

  it("starts over once things have been quiet for a minute", () => {
    let now = 1_000_000;
    for (let i = 0; i < 8; i++) {
      now += retryDelay(now, 0.5);
      noteRetry(now);
    }
    expect(retryDelay(now + 61_000, 0.5)).toBe(2_000);
  });

  it("is a little uneven, so tabs do not ask in step", () => {
    expect(retryDelay(1_000_000, 0)).toBe(1_700);
    expect(retryDelay(1_000_000, 0.999)).toBeGreaterThan(2_250);
    expect(retryDelay(1_000_000, 0.999)).toBeLessThanOrEqual(2_300);
  });
});
