import { PRESENCE_ONLINE_MINUTES } from "@abay/contracts";

import { presenceAt } from "@/modules/presence/presence.service";

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
