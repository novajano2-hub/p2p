import { PRESENCE_ONLINE_MINUTES } from "@abay/contracts";

import { presenceAt, presenceFrom } from "@/modules/presence/presence.service";

/*
  The rule behind the green dot, without Redis or a database: seen within
  the window is online, the time shown is to the minute, and a clock that
  ran ahead on another replica is not believed past now.
*/

const MINUTE = 60_000;
const NOW = Date.parse("2026-09-18T12:00:30.000Z");

describe("presenceAt", () => {
  it("says nothing about someone never seen", () => {
    expect(presenceAt(0, NOW)).toEqual({ online: false, lastSeenAt: null });
  });

  it("is online up to the window and offline past it", () => {
    expect(presenceAt(NOW, NOW).online).toBe(true);
    expect(presenceAt(NOW - PRESENCE_ONLINE_MINUTES * MINUTE, NOW).online).toBe(true);
    expect(presenceAt(NOW - PRESENCE_ONLINE_MINUTES * MINUTE - 1, NOW).online).toBe(false);
  });

  it("gives the time to the minute, never finer", () => {
    const seen = Date.parse("2026-09-18T09:41:59.999Z");
    expect(presenceAt(seen, NOW)).toEqual({
      online: false,
      lastSeenAt: "2026-09-18T09:41:00.000Z",
    });
  });

  it("takes a time from a clock running ahead as now", () => {
    expect(presenceAt(NOW + 90_000, NOW)).toEqual({
      online: true,
      lastSeenAt: "2026-09-18T12:00:00.000Z",
    });
  });
});

/*
  The two witnesses together. The live connection's word is a time when it
  heard from them, or - written negative - the time their last tab closed,
  which is a person leaving and not five more minutes of "Online".
*/
describe("presenceFrom", () => {
  const SESSION_LONG_AGO = NOW - 3 * 3_600_000;

  it("has someone with a tab open online, whatever the session last said", () => {
    expect(presenceFrom(NOW - 20_000, SESSION_LONG_AGO, NOW).online).toBe(true);
  });

  it("has someone who closed their last tab offline at once, last seen when they left", () => {
    const left = NOW - 20_000;
    expect(presenceFrom(-left, left - 40_000, NOW)).toEqual({
      online: false,
      lastSeenAt: "2026-09-18T12:00:00.000Z",
    });
  });

  it("believes a session used after they left: they are back, if only by a request", () => {
    const left = NOW - 3 * MINUTE;
    expect(presenceFrom(-left, NOW - MINUTE, NOW)).toEqual({
      online: true,
      lastSeenAt: "2026-09-18T11:59:00.000Z",
    });
  });

  it("keeps the window for someone the live connection never heard from", () => {
    expect(presenceFrom(0, NOW - 4 * MINUTE, NOW).online).toBe(true);
    expect(presenceFrom(0, NOW - 6 * MINUTE, NOW).online).toBe(false);
    expect(presenceFrom(0, 0, NOW)).toEqual({ online: false, lastSeenAt: null });
  });
});
