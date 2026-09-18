import { toast as sonner } from "sonner";

import { alreadySaid, notificationKey, toast } from "@/lib/toast";

/*
  The one piece of the toast module with logic in it: a tab that has just said
  something itself does not say it again when the same news comes back over
  the socket. The seller who releases is the case that needs it.
*/

describe("how long a toast stays", () => {
  const duration = (id: string | number) => {
    const said = sonner.getToasts().find((each) => each.id === id);
    return said && "duration" in said ? said.duration : undefined;
  };

  it("gives a confirmation four seconds, and anything to be read eight", () => {
    expect(duration(toast.success("Ad posted"))).toBe(4_000);
    expect(duration(toast.error("That password is not right."))).toBe(8_000);
    expect(duration(toast.warning("The advertiser changed this ad"))).toBe(8_000);
    // News is read slowly whatever it says: good news still offers somewhere to go.
    expect(duration(toast.news("good", "Deposit credited"))).toBe(8_000);
    expect(duration(toast.news("warn", "Trade expired"))).toBe(8_000);
    expect(duration(toast.news("note", "New message"))).toBe(8_000);
  });
});

describe("news this tab has already said", () => {
  const released = notificationKey("TRADE_RELEASED", "/orders/t1");

  it("is said once, not twice", () => {
    toast.success("USDT released", { covers: released });
    expect(alreadySaid(released)).toBe(true);
    // Asking forgets it: the next release on the same order is news again.
    expect(alreadySaid(released)).toBe(false);
  });

  it("belongs to one notification only", () => {
    toast.success("USDT released", { covers: released });
    expect(alreadySaid(notificationKey("TRADE_RELEASED", "/orders/t2"))).toBe(false);
    expect(alreadySaid(notificationKey("TRADE_PAID", "/orders/t1"))).toBe(false);
    expect(alreadySaid(released)).toBe(true);
  });

  it("is forgotten after a minute", () => {
    toast.success("USDT released", { covers: released });
    expect(alreadySaid(released, Date.now() + 61_000)).toBe(false);
  });

  it("is never assumed for news this tab did not say", () => {
    expect(alreadySaid(notificationKey("DEPOSIT_CREDITED", "/wallet"))).toBe(false);
  });
});
