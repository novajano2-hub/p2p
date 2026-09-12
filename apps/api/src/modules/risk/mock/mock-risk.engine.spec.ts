import { loadEnv } from "@/config/env";

import { MockRiskEngine } from "./mock-risk.engine";

const USDT = 1_000_000n;

const engine = () =>
  new MockRiskEngine(
    loadEnv({
      CORS_ORIGINS: "http://localhost:3000",
      WEB_URL: "http://localhost:3000",
      API_URL: "http://localhost:3001",
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      REDIS_URL: "redis://localhost:6379",
      EMAIL_FROM: "BIRQ <no-reply@example.com>",
      FIELD_ENCRYPTION_KEY: "0".repeat(64),
      WITHDRAWAL_AUTO_APPROVE_MICRO: (2_000n * USDT).toString(),
      WITHDRAWAL_DUAL_APPROVAL_MICRO: (10_000n * USDT).toString(),
      WITHDRAWAL_NEW_ADDRESS_COOLDOWN_HOURS: "24",
      DEPOSIT_REVIEW_THRESHOLD_MICRO: (10_000n * USDT).toString(),
    }),
  );

const base = {
  userId: "u",
  kycStatus: "APPROVED" as const,
  destination: "0x" + "a".repeat(40),
  dailyTotal: 0n,
};
const aged = new Date(Date.now() - 48 * 60 * 60 * 1000);

describe("the launch withdrawal policy", () => {
  it("auto-approves an ordinary withdrawal to a known address: no human involved", async () => {
    const verdict = await engine().evaluateWithdrawal({
      ...base,
      amount: 500n * USDT,
      destinationFirstUsedAt: aged,
    });
    expect(verdict).toEqual({
      decision: "AUTO_APPROVE",
      score: 0,
      reasons: [],
      approvalsRequired: 0,
    });
  });

  it("stops a withdrawal to a brand-new address, whatever the amount", async () => {
    const verdict = await engine().evaluateWithdrawal({
      ...base,
      amount: 5n * USDT,
      destinationFirstUsedAt: null,
    });
    expect(verdict.decision).toBe("REVIEW");
    expect(verdict.approvalsRequired).toBe(1);
    expect(verdict.reasons).toEqual(["destination never used before"]);
  });

  it("needs one approver above the auto threshold and two above the dual one", async () => {
    const one = await engine().evaluateWithdrawal({
      ...base,
      amount: 2_000n * USDT,
      destinationFirstUsedAt: aged,
    });
    expect(one.approvalsRequired).toBe(1);
    const two = await engine().evaluateWithdrawal({
      ...base,
      amount: 10_000n * USDT,
      destinationFirstUsedAt: aged,
    });
    expect(two.approvalsRequired).toBe(2);
  });

  it("credits an ordinary deposit and holds only a very large one", async () => {
    const small = await engine().evaluateDeposit({ userId: "u", amount: 900n * USDT, from: "0x1" });
    expect(small.decision).toBe("CREDIT");
    const large = await engine().evaluateDeposit({
      userId: "u",
      amount: 10_000n * USDT,
      from: "0x1",
    });
    expect(large).toEqual({
      decision: "REVIEW",
      reasons: ["amount at or above the review threshold"],
    });
  });
});
