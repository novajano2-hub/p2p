"use client";

import { ArrowDown, ArrowUp } from "@phosphor-icons/react";
import { type ReactNode } from "react";

import { Amount } from "@/components/wallet/shared";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { cn } from "@/lib/cn";
import { type Deposit, type Withdrawal } from "@/lib/wallet/client";
import { DEPOSIT_WORDS, WITHDRAWAL_WORDS } from "@/lib/wallet/status";

/*
  A transfer, as one row.

  Money in and money out share a row because a person reading their wallet is
  asking one question - what happened and where is it - and answering it in
  two different layouts would make them learn two. The direction is a sign and
  an arrow; the rest is the same.

  Every row says what its state means in a sentence, not only in a word. "Being
  checked" on its own invites the worst reading; "a person is looking at this
  one, usually a matter of hours" does not.
*/

export const when = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

export interface Activity {
  id: string;
  direction: "in" | "out";
  amount: string;
  words: string;
  tone: StatusTone;
  detail: string;
  at: string;
  network: string;
  txHash: string | null;
  /** Shown only while they are still being counted. */
  confirmations: { have: number; need: number } | null;
  action?: ReactNode;
}

export const fromDeposit = (deposit: Deposit): Activity => {
  const said = DEPOSIT_WORDS[deposit.status];
  return {
    id: deposit.id,
    direction: "in",
    amount: deposit.amount,
    words: said.words,
    tone: said.tone,
    detail: said.detail,
    at: deposit.creditedAt ?? deposit.detectedAt,
    network: deposit.network,
    txHash: deposit.txHash,
    confirmations:
      deposit.status === "CONFIRMING"
        ? { have: deposit.confirmations, need: deposit.confirmationsRequired }
        : null,
  };
};

export const fromWithdrawal = (withdrawal: Withdrawal, action?: ReactNode): Activity => {
  const said = WITHDRAWAL_WORDS[withdrawal.stage];
  return {
    id: withdrawal.id,
    direction: "out",
    amount: withdrawal.amount,
    words: said.words,
    tone: said.tone,
    // The server's own sentence when it has one: it knows why this particular
    // withdrawal stopped, and the table only knows what the stage means.
    detail: withdrawal.message ?? said.detail,
    at: withdrawal.settledAt ?? withdrawal.requestedAt,
    network: withdrawal.network,
    txHash: withdrawal.txHash,
    confirmations:
      withdrawal.stage === "SENDING"
        ? { have: withdrawal.confirmations, need: withdrawal.confirmationsRequired }
        : null,
    ...(action ? { action } : {}),
  };
};

export function ActivityList({ items }: { items: readonly Activity[] }) {
  return (
    <ul className="divide-border divide-y">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-3.5 py-3.5 first:pt-0 last:pb-0">
          <span
            className={cn(
              "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full",
              item.direction === "in"
                ? "bg-status-complete text-status-complete-fg"
                : "bg-muted text-muted-foreground",
            )}
          >
            {item.direction === "in" ? (
              <ArrowDown size={17} weight="bold" aria-hidden="true" />
            ) : (
              <ArrowUp size={17} weight="bold" aria-hidden="true" />
            )}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-foreground text-[15px] font-semibold">
                {item.direction === "in" ? "+" : "−"}
                <Amount value={item.amount} className="text-[15px]" />
              </p>
              <StatusPill status={item.tone}>{item.words}</StatusPill>
            </div>

            <p className="text-muted-foreground mt-1 text-[12px] leading-relaxed">{item.detail}</p>

            <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px]">
              <span className="tabular-nums">{when.format(new Date(item.at))}</span>
              <span aria-hidden="true">·</span>
              <span>{item.network}</span>
              {item.confirmations ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    {item.confirmations.have} / {item.confirmations.need} confirmations
                  </span>
                </>
              ) : null}
              {item.txHash ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono break-all">{item.txHash}</span>
                </>
              ) : null}
            </div>

            {item.action ? <div className="mt-2.5">{item.action}</div> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
