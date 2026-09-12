import {
  accounts,
  allowsNegative,
  formatAccountCode,
  InvalidAccountCodeError,
  parseAccountCode,
  PLATFORM_ACCOUNTS,
} from "./account-code";

describe("account codes", () => {
  it("round-trips every shape the taxonomy uses", () => {
    for (const code of [
      "LIAB:USER:0190abcd-1111-7000-8000-000000000001:USDT:AVAILABLE",
      "LIAB:USER:someone:USDT:PENDING_WITHDRAWAL",
      "LIAB:TRADE:T-123:USDT:ESCROW",
      "ASSET:PLATFORM:USDT:TREASURY_HOT",
      "REV:PLATFORM:USDT:TRADE_FEES",
      "EXP:PLATFORM:USDT:NETWORK_FEES",
      "EQUITY:PLATFORM:USDT:OPENING_BALANCE",
    ]) {
      expect(formatAccountCode(parseAccountCode(code))).toBe(code);
    }
  });

  it("maps the short prefixes to the enum types", () => {
    expect(parseAccountCode("LIAB:USER:u:USDT:AVAILABLE").type).toBe("LIABILITY");
    expect(parseAccountCode("REV:PLATFORM:USDT:TRADE_FEES").type).toBe("REVENUE");
    expect(parseAccountCode("EXP:PLATFORM:USDT:LOSSES").type).toBe("EXPENSE");
    expect(parseAccountCode("ASSET:PLATFORM:USDT:IN_TRANSIT").type).toBe("ASSET");
    expect(parseAccountCode("EQUITY:PLATFORM:USDT:OPENING_BALANCE").type).toBe("EQUITY");
  });

  it("gives platform accounts no owner and everyone else one", () => {
    expect(parseAccountCode("ASSET:PLATFORM:USDT:TREASURY_HOT").ownerId).toBeNull();
    expect(parseAccountCode("LIAB:TRADE:T-9:USDT:ESCROW").ownerId).toBe("T-9");
  });

  it("refuses what is not a code, naming the problem", () => {
    const bad: [string, RegExp][] = [
      ["", /unknown type/],
      ["CASH:USER:u:USDT:AVAILABLE", /unknown type/],
      ["LIAB:HOUSE:u:USDT:AVAILABLE", /unknown scope/],
      ["LIAB:USER:USDT:AVAILABLE", /expected 5 segments/],
      ["ASSET:PLATFORM:u:USDT:TREASURY_HOT", /expected 4 segments/],
      ["LIAB:USER::USDT:AVAILABLE", /needs an owner/],
      ["LIAB:USER:u:ETB:AVAILABLE", /unknown asset/],
      ["LIAB:USER:u:USDT:available", /UPPER_SNAKE/],
      ["LIAB:USER:u:USDT:", /UPPER_SNAKE/],
    ];
    for (const [code, problem] of bad) {
      expect(() => parseAccountCode(code)).toThrow(InvalidAccountCodeError);
      expect(() => parseAccountCode(code)).toThrow(problem);
    }
  });

  it("builds the named accounts without anyone assembling a string", () => {
    expect(accounts.userAvailable("sara")).toBe("LIAB:USER:sara:USDT:AVAILABLE");
    expect(accounts.userPendingWithdrawal("dawit")).toBe("LIAB:USER:dawit:USDT:PENDING_WITHDRAWAL");
    expect(accounts.tradeEscrow("T-123")).toBe("LIAB:TRADE:T-123:USDT:ESCROW");
    expect(accounts.platform("TREASURY_HOT")).toBe("ASSET:PLATFORM:USDT:TREASURY_HOT");
    expect(accounts.platform("TRADE_FEES")).toBe("REV:PLATFORM:USDT:TRADE_FEES");
  });

  /*
    The migration seeds these eleven by name. If the two lists ever disagree,
    the service would ask for a platform account the database does not have.
  */
  it("names exactly the eleven platform accounts the migration seeds", () => {
    expect(Object.keys(PLATFORM_ACCOUNTS).sort()).toEqual(
      [
        "DEPOSIT_ADDRESSES",
        "IN_TRANSIT",
        "LOSSES",
        "NETWORK_FEES",
        "OPENING_BALANCE",
        "RECONCILIATION_SUSPENSE",
        "TRADE_FEES",
        "TREASURY_COLD",
        "TREASURY_HOT",
        "UNIDENTIFIED_DEPOSITS",
        "WITHDRAWAL_FEES",
      ].sort(),
    );
  });

  it("lets only equity, revenue and expense go negative", () => {
    expect(allowsNegative("ASSET")).toBe(false);
    expect(allowsNegative("LIABILITY")).toBe(false);
    expect(allowsNegative("EQUITY")).toBe(true);
    expect(allowsNegative("REVENUE")).toBe(true);
    expect(allowsNegative("EXPENSE")).toBe(true);
  });
});
