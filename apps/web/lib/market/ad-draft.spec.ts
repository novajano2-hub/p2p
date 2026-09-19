import { keepDraft, takeDraft, withAdded, type KeptDraft } from "./ad-draft";

/* An ad half written, kept while its author adds a payment method. */

const DRAFT: KeptDraft = {
  ad: "new",
  step: 1,
  values: {
    side: "SELL",
    price: "158.80",
    total: "100",
    min: "500",
    max: "",
    window: 30,
    methodIds: ["pm1"],
    kinds: [],
    terms: "",
    autoReply: "",
    requireVerified: false,
    minCompletedTrades: "0",
  },
  methodIds: ["pm1"],
};

describe("the ad kept while a payment method is added", () => {
  const store = new Map<string, string>();
  const sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };

  beforeAll(() => {
    (globalThis as { window?: unknown }).window = { sessionStorage };
  });
  afterAll(() => {
    delete (globalThis as { window?: unknown }).window;
  });
  beforeEach(() => store.clear());

  it("comes back once, as it was left", () => {
    keepDraft(DRAFT);
    expect(takeDraft("new")).toEqual(DRAFT);
    expect(takeDraft("new")).toBeNull();
  });

  it("comes back only to its own form, and not after half an hour", () => {
    keepDraft(DRAFT);
    expect(takeDraft("a1")).toBeNull();
    keepDraft(DRAFT);
    expect(takeDraft("new", Date.now() + 31 * 60_000)).toBeNull();
  });

  it("is dropped when it is not a draft at all", () => {
    store.set("birq.ad-draft", "not json");
    expect(takeDraft("new")).toBeNull();
    store.set("birq.ad-draft", JSON.stringify({ ...DRAFT, at: Date.now(), values: { side: "X" } }));
    expect(takeDraft("new")).toBeNull();
  });

  it("is simply not kept when storage is refused", () => {
    (globalThis as { window?: unknown }).window = {
      sessionStorage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
        removeItem: () => undefined,
      },
    };
    expect(() => keepDraft(DRAFT)).not.toThrow();
    expect(takeDraft("new")).toBeNull();
    (globalThis as { window?: unknown }).window = { sessionStorage };
  });
});

describe("withAdded", () => {
  it("puts the method added meanwhile into the ad, while there is room", () => {
    expect(withAdded(DRAFT, ["pm1", "pm2"], 5)).toEqual(["pm1", "pm2"]);
    // Nothing new: the ad's own choice stands, unticked ones included.
    expect(withAdded({ ...DRAFT, values: { ...DRAFT.values, methodIds: [] } }, ["pm1"], 5)).toEqual(
      [],
    );
    const full = ["pm1", "pm2", "pm3", "pm4", "pm5"];
    const five = { ...DRAFT, values: { ...DRAFT.values, methodIds: full }, methodIds: full };
    expect(withAdded(five, [...full, "pm6"], 5)).toEqual(full);
  });
});
