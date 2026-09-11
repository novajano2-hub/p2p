import { rateLimitAddress, subjectHash } from "./rate-limit.keys";

describe("subjectHash", () => {
  it("is stable, and short enough to be a key", () => {
    expect(subjectHash("someone@example.com")).toBe(subjectHash("someone@example.com"));
    expect(subjectHash("someone@example.com")).toHaveLength(32);
  });

  it("does not contain what went into it", () => {
    expect(subjectHash("someone@example.com")).not.toContain("someone");
  });

  it("separates two subjects", () => {
    expect(subjectHash("a@example.com")).not.toBe(subjectHash("b@example.com"));
  });
});

describe("rateLimitAddress", () => {
  it("leaves an IPv4 address alone", () => {
    expect(rateLimitAddress("203.0.113.7")).toBe("203.0.113.7");
  });

  /*
    The same client reaches a dual-stack socket as ::ffff:a.b.c.d and a v4-only
    socket as a.b.c.d. Two counters for one caller would double every limit.
  */
  it("treats a mapped address as the IPv4 address it is", () => {
    expect(rateLimitAddress("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitAddress("::ffff:127.0.0.1")).toBe(rateLimitAddress("127.0.0.1"));
  });

  /*
    The point of the /64: an attacker holding a routine allocation must not get
    a fresh counter for every address in it.
  */
  it("counts every address in a /64 as one subject", () => {
    const first = rateLimitAddress("2001:db8:1234:5678:0000:0000:0000:0001");
    const second = rateLimitAddress("2001:db8:1234:5678:ffff:ffff:ffff:ffff");
    expect(first).toBe(second);
    expect(first).toBe("2001:db8:1234:5678::/64");
  });

  it("keeps two different /64s apart", () => {
    expect(rateLimitAddress("2001:db8:1234:5678::1")).not.toBe(
      rateLimitAddress("2001:db8:1234:9999::1"),
    );
  });

  it("expands the compressed form the same way as the written-out one", () => {
    expect(rateLimitAddress("2001:db8::1")).toBe(
      rateLimitAddress("2001:0db8:0000:0000:0000:0000:0000:0001"),
    );
  });

  it("handles the ends of the range and a zone identifier", () => {
    expect(rateLimitAddress("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitAddress("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  /* Nonsense must still produce a usable key rather than throw or collapse. */
  it("falls back to the address itself when it cannot be parsed", () => {
    expect(rateLimitAddress("2001:db8::1::2")).toBe("2001:db8::1::2");
    expect(rateLimitAddress("not:an:address")).toBe("not:an:address");
  });
});
