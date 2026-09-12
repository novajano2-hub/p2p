import { accounts } from "./account-code";
import {
  LedgerPostingError,
  naturalDelta,
  type PostingRequest,
  signedAmount,
  validatePosting,
} from "./posting";

/** JE-1 from the taxonomy: a deposit of 100 USDT credited to Sara. */
const deposit = (): PostingRequest => ({
  reason: "DEPOSIT_CREDITED",
  asset: "USDT",
  reference: { type: "deposit", id: "dep-1" },
  actor: { type: "SYSTEM" },
  correlationId: "corr-1",
  idempotencyKey: "deposit:dep-1:credit",
  lines: [
    { account: accounts.platform("DEPOSIT_ADDRESSES"), direction: "DEBIT", amount: 100_000_000n },
    { account: accounts.userAvailable("sara"), direction: "CREDIT", amount: 100_000_000n },
  ],
});

const problemsOf = (request: PostingRequest): string[] => {
  try {
    validatePosting(request);
  } catch (error) {
    if (error instanceof LedgerPostingError) {
      return (error.details ?? []).map((d) => `${d.path}: ${d.message}`);
    }
    throw error;
  }
  return [];
};

describe("validatePosting", () => {
  it("accepts a balanced two-line posting and signs its lines", () => {
    const posting = validatePosting(deposit());
    expect(posting.lines.map((l) => l.signedAmount)).toEqual([100_000_000n, -100_000_000n]);
    expect(posting.lines[1]?.descriptor.ownerId).toBe("sara");
  });

  it("refuses debits and credits that do not sum to zero, and says by how much", () => {
    const request = deposit();
    request.lines = [request.lines[0]!, { ...request.lines[1]!, amount: 99_000_000n }];
    expect(problemsOf(request)).toEqual([
      "lines: debits and credits differ by 1000000 micro-units",
    ]);
  });

  it("refuses a posting with a single line", () => {
    const request = deposit();
    request.lines = [request.lines[0]!];
    expect(problemsOf(request)).toContain("lines: a journal entry needs at least two lines");
  });

  it("refuses a negative amount rather than reading it as the other direction", () => {
    const request = deposit();
    request.lines = [{ ...request.lines[0]!, amount: -1n }, request.lines[1]!];
    expect(problemsOf(request)).toContain(
      "lines.0.amount: must not be negative; the direction carries the sense",
    );
  });

  /* A JavaScript number cannot hold micro-USDT past 2^53 without rounding. */
  it("refuses an amount that is a number", () => {
    const request = deposit();
    request.lines = [{ ...request.lines[0]!, amount: 100 as unknown as bigint }, request.lines[1]!];
    expect(problemsOf(request)).toContain(
      "lines.0.amount: must be a bigint of micro-units, never a number",
    );
  });

  it("refuses a line whose account is not a code", () => {
    const request = deposit();
    request.lines = [{ ...request.lines[0]!, account: "sara's money" }, request.lines[1]!];
    expect(problemsOf(request)[0]).toMatch(/^lines\.0\.account: "sara's money" is not/);
  });

  it("allows a zero-amount line, because the fee leg is posted at zero while fees are off", () => {
    const request = deposit();
    request.lines = [
      ...request.lines,
      { account: accounts.platform("TRADE_FEES"), direction: "CREDIT", amount: 0n },
    ];
    expect(() => validatePosting(request)).not.toThrow();
  });

  it("holds actors to their shape: SYSTEM has no id, a person must", () => {
    const system = deposit();
    system.actor = { type: "SYSTEM", id: "someone" };
    expect(problemsOf(system)).toContain("actor.id: a SYSTEM actor carries no id");

    const user = deposit();
    user.actor = { type: "USER" };
    expect(problemsOf(user)).toContain("actor.id: a USER actor needs an id");
  });

  it("requires the metadata the taxonomy calls mandatory (L10)", () => {
    const request = deposit();
    request.correlationId = "";
    request.idempotencyKey = "";
    request.reference = { type: "", id: "" };
    expect(problemsOf(request)).toEqual(
      expect.arrayContaining([
        "correlationId: required",
        "idempotencyKey: required",
        "reference.type: required",
        "reference.id: required",
      ]),
    );
  });
});

describe("the sign convention", () => {
  it("signs a debit positive and a credit negative", () => {
    expect(signedAmount("DEBIT", 5n)).toBe(5n);
    expect(signedAmount("CREDIT", 5n)).toBe(-5n);
  });

  /*
    Pinned to the balance trigger's arithmetic in
    packages/database/sql/ledger-balance-projection.sql. JE-1: the asset is
    debited and the liability credited, and BOTH balances go up by 100.
  */
  it("moves every account in its natural sense, matching the database trigger", () => {
    expect(naturalDelta("ASSET", "DEBIT", 100n)).toBe(100n);
    expect(naturalDelta("LIABILITY", "CREDIT", 100n)).toBe(100n);
    expect(naturalDelta("ASSET", "CREDIT", 100n)).toBe(-100n);
    expect(naturalDelta("LIABILITY", "DEBIT", 100n)).toBe(-100n);
    expect(naturalDelta("EXPENSE", "DEBIT", 100n)).toBe(100n);
    expect(naturalDelta("REVENUE", "CREDIT", 100n)).toBe(100n);
    expect(naturalDelta("EQUITY", "DEBIT", 100n)).toBe(-100n);
  });
});
