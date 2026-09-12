import { type LedgerAccountScope, type LedgerAccountType, type LedgerAsset } from "@abay/database";

/*
  The account code: {TYPE}:{SCOPE}:{OWNER}:{ASSET}:{PURPOSE}, from
  docs/architecture/ledger-taxonomy.md section 2.

  A code is how the rest of the application names an account - "Sara's
  available USDT", "the escrow for trade T-123" - without knowing or caring
  about the row's uuid. This module is the only place the format is known:
  everything else builds codes with the constructors below and reads them
  with parseAccountCode, so a typo cannot become a phantom account and a
  change to the format is a change in one file.
*/

/** The short prefixes the taxonomy uses in codes, mapped to the enum they mean. */
const PREFIX_TO_TYPE = {
  ASSET: "ASSET",
  LIAB: "LIABILITY",
  EQUITY: "EQUITY",
  REV: "REVENUE",
  EXP: "EXPENSE",
} as const satisfies Record<string, LedgerAccountType>;

type TypePrefix = keyof typeof PREFIX_TO_TYPE;

const TYPE_TO_PREFIX: Record<LedgerAccountType, TypePrefix> = {
  ASSET: "ASSET",
  LIABILITY: "LIAB",
  EQUITY: "EQUITY",
  REVENUE: "REV",
  EXPENSE: "EXP",
};

const SCOPES: readonly LedgerAccountScope[] = ["USER", "TRADE", "PLATFORM"];
const ASSETS: readonly LedgerAsset[] = ["USDT"];

/** UPPER_SNAKE, like every purpose the taxonomy names. */
const PURPOSE = /^[A-Z][A-Z0-9_]*$/;

export interface AccountDescriptor {
  type: LedgerAccountType;
  scope: LedgerAccountScope;
  /** The user or trade id. Null for PLATFORM, whose code has no owner segment. */
  ownerId: string | null;
  asset: LedgerAsset;
  purpose: string;
}

export class InvalidAccountCodeError extends Error {
  constructor(code: string, problem: string) {
    super(`"${code}" is not a ledger account code: ${problem}`);
    this.name = "InvalidAccountCodeError";
  }
}

export function formatAccountCode(account: AccountDescriptor): string {
  const prefix = TYPE_TO_PREFIX[account.type];
  if (account.scope === "PLATFORM") {
    return `${prefix}:PLATFORM:${account.asset}:${account.purpose}`;
  }
  return `${prefix}:${account.scope}:${account.ownerId ?? ""}:${account.asset}:${account.purpose}`;
}

export function parseAccountCode(code: string): AccountDescriptor {
  const parts = code.split(":");
  const [prefix, scope] = parts;

  if (!prefix || !(prefix in PREFIX_TO_TYPE)) {
    throw new InvalidAccountCodeError(code, `unknown type "${prefix ?? ""}"`);
  }
  if (!scope || !SCOPES.includes(scope as LedgerAccountScope)) {
    throw new InvalidAccountCodeError(code, `unknown scope "${scope ?? ""}"`);
  }

  // PLATFORM codes have four segments; USER and TRADE codes have five.
  const expected = scope === "PLATFORM" ? 4 : 5;
  if (parts.length !== expected) {
    throw new InvalidAccountCodeError(code, `expected ${expected} segments, got ${parts.length}`);
  }

  const ownerId = scope === "PLATFORM" ? null : (parts[2] ?? "");
  const asset = parts[expected - 2] ?? "";
  const purpose = parts[expected - 1] ?? "";

  if (scope !== "PLATFORM" && ownerId === "") {
    throw new InvalidAccountCodeError(code, "a USER or TRADE account needs an owner");
  }
  if (!ASSETS.includes(asset as LedgerAsset)) {
    throw new InvalidAccountCodeError(code, `unknown asset "${asset}"`);
  }
  if (!PURPOSE.test(purpose)) {
    throw new InvalidAccountCodeError(code, `purpose "${purpose}" must be UPPER_SNAKE`);
  }

  return {
    type: PREFIX_TO_TYPE[prefix as TypePrefix],
    scope: scope as LedgerAccountScope,
    ownerId,
    asset: asset as LedgerAsset,
    purpose,
  };
}

/*
  ---------------------------------------------------------- the known codes
  Constructors for every account the taxonomy names, so callers write
  accounts.userAvailable(userId) and never assemble a string.
*/

/** The eleven platform accounts (taxonomy 3.3 - 3.6), by purpose, with their type. */
export const PLATFORM_ACCOUNTS = {
  DEPOSIT_ADDRESSES: "ASSET",
  TREASURY_HOT: "ASSET",
  TREASURY_COLD: "ASSET",
  IN_TRANSIT: "ASSET",
  UNIDENTIFIED_DEPOSITS: "LIABILITY",
  RECONCILIATION_SUSPENSE: "LIABILITY",
  TRADE_FEES: "REVENUE",
  WITHDRAWAL_FEES: "REVENUE",
  NETWORK_FEES: "EXPENSE",
  LOSSES: "EXPENSE",
  OPENING_BALANCE: "EQUITY",
} as const satisfies Record<string, LedgerAccountType>;

export type PlatformPurpose = keyof typeof PLATFORM_ACCOUNTS;

export const accounts = {
  /** Spendable. The number a customer sees as "Available". */
  userAvailable: (userId: string, asset: LedgerAsset = "USDT"): string =>
    formatAccountCode({
      type: "LIABILITY",
      scope: "USER",
      ownerId: userId,
      asset,
      purpose: "AVAILABLE",
    }),

  /** Committed to a withdrawal that has not yet left the chain. "Withdrawing". */
  userPendingWithdrawal: (userId: string, asset: LedgerAsset = "USDT"): string =>
    formatAccountCode({
      type: "LIABILITY",
      scope: "USER",
      ownerId: userId,
      asset,
      purpose: "PENDING_WITHDRAWAL",
    }),

  /** The USDT locked for exactly one trade (ADR-0004). */
  tradeEscrow: (tradeId: string, asset: LedgerAsset = "USDT"): string =>
    formatAccountCode({
      type: "LIABILITY",
      scope: "TRADE",
      ownerId: tradeId,
      asset,
      purpose: "ESCROW",
    }),

  /** One of the platform's own accounts. Seeded by migration; never created on the fly. */
  platform: (purpose: PlatformPurpose, asset: LedgerAsset = "USDT"): string =>
    formatAccountCode({
      type: PLATFORM_ACCOUNTS[purpose],
      scope: "PLATFORM",
      ownerId: null,
      asset,
      purpose,
    }),
} as const;

/**
 * Whether a balance in this account may go below zero. Derived from the
 * type, exactly as the migration derives it when it seeds the platform
 * accounts: only equity, revenue and expense positions can legitimately sit
 * either side of zero. Customers, trades and piles of coins cannot.
 */
export const allowsNegative = (type: LedgerAccountType): boolean =>
  type === "EQUITY" || type === "REVENUE" || type === "EXPENSE";
