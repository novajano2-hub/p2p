"use client";

import { ArrowDown, ArrowUp } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

import { CopyButton } from "@/components/app/copy-button";
import { Amount } from "@/components/wallet/shared";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { cn } from "@/lib/cn";
import { toast, toastFailure } from "@/lib/toast";
import { walletClient, type Deposit, type Withdrawal } from "@/lib/wallet/client";
import { DEPOSIT_WORDS, WITHDRAWAL_WORDS } from "@/lib/wallet/status";

/*
  Money in and money out, as one list.

  They share a row because a person reading their wallet is asking one
  question - what happened and where is it - and answering it in two layouts
  would make them learn two. The direction is a word, a sign and an arrow; the
  rest is the same.

  One element per movement: a row of a table from lg up, a card below it.
  Every one says what its state means in a sentence, not only in a word.
  "Being checked" on its own invites the worst reading; "a person is reviewing
  this one, your money is held, not spent" does not. While the network is
  still counting, the count is a bar as well as a number.
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

/** Deposits and withdrawals together, newest first, a withdrawal that can still be called off saying so. */
export function mergeActivity(
  deposits: readonly Deposit[],
  withdrawals: readonly Withdrawal[],
  onChanged: () => void,
): Activity[] {
  const rows = [
    ...deposits.map((deposit) => fromDeposit(deposit)),
    ...withdrawals.map((withdrawal) =>
      fromWithdrawal(
        withdrawal,
        withdrawal.cancellable ? (
          <CancelWithdrawal id={withdrawal.id} onCancelled={onChanged} />
        ) : undefined,
      ),
    ),
  ];
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

/*
  The table's columns from lg up: type, amount, status, when, and what
  identifies it on the chain. Every row is a grid of its own, so every track is
  a fixed width or a share of what is left - one sized to its content would
  put each row's columns somewhere different.
*/
const COLUMNS = "lg:grid-cols-[7.5rem_10rem_minmax(0,1fr)_9.5rem_10.625rem] lg:gap-x-5";

export function ActivityList({
  items,
  label = "Activity",
}: {
  items: readonly Activity[];
  label?: string;
}) {
  return (
    <div role="group" aria-label={label}>
      <div
        aria-hidden="true"
        className={cn(
          "text-muted-foreground border-border hidden border-b pb-3 text-[12px] font-medium lg:grid",
          COLUMNS,
        )}
      >
        <span>Type</span>
        <span>Amount</span>
        <span>Status</span>
        <span>When</span>
        <span className="text-right">Transaction</span>
      </div>
      <ul className="divide-border divide-y">
        {items.map((item) => (
          <ActivityRow key={item.id} item={item} />
        ))}
      </ul>
    </div>
  );
}

function ActivityRow({ item }: { item: Activity }) {
  const incoming = item.direction === "in";
  const Arrow = incoming ? ArrowDown : ArrowUp;
  const trail =
    item.confirmations || item.txHash || item.action ? (
      // Side by side on a card; one over the other in the table's last column, which is only so wide.
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 lg:flex-col lg:flex-nowrap lg:items-end">
        {item.confirmations ? <Confirmations {...item.confirmations} /> : null}
        {item.txHash ? <TxHash hash={item.txHash} /> : null}
        {item.action ? <div>{item.action}</div> : null}
      </div>
    ) : null;

  return (
    <li
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 py-4 first:pt-3 last:pb-1 lg:items-center",
        COLUMNS,
      )}
    >
      <p className="text-foreground flex items-center gap-2 text-sm font-medium">
        <Arrow size={16} weight="bold" aria-hidden="true" className="text-muted-foreground" />
        {incoming ? "Deposit" : "Withdrawal"}
      </p>

      <p
        className={cn(
          "font-mono text-[17px] font-medium max-lg:col-start-1 max-lg:row-start-2 lg:text-[15px]",
          incoming ? "text-status-complete-fg" : "text-foreground",
        )}
      >
        {incoming ? "+" : "−"}
        <Amount value={item.amount} />
      </p>

      <div className="min-w-0 max-lg:contents">
        <p className="max-lg:col-start-2 max-lg:row-start-1 max-lg:justify-self-end">
          <StatusPill status={item.tone}>{item.words}</StatusPill>
        </p>
        <p className="text-muted-foreground text-[12.5px] leading-relaxed max-lg:col-span-2 max-lg:row-start-3 lg:mt-1">
          {item.detail}
        </p>
      </div>

      <p className="text-muted-foreground text-[12.5px] tabular-nums max-lg:col-start-2 max-lg:row-start-2 max-lg:self-end max-lg:justify-self-end lg:text-[13px]">
        {when.format(new Date(item.at))}
        <span className="max-lg:hidden">
          <br />
          <span className="text-[12px]">{item.network}</span>
        </span>
      </p>

      {trail ? (
        <div className="max-lg:col-span-2 max-lg:row-start-4">{trail}</div>
      ) : (
        <span className="max-lg:hidden" />
      )}
    </li>
  );
}

/** How far the network has counted: the figure, and the same thing as a bar. */
function Confirmations({ have, need }: { have: number; need: number }) {
  const share = need > 0 ? Math.min(100, Math.round((have / need) * 100)) : 0;
  return (
    <div className="flex w-36 flex-col gap-1.5">
      <p className="text-muted-foreground text-[12px] tabular-nums">
        {have} / {need} confirmations
      </p>
      <div
        role="progressbar"
        aria-label="Confirmations"
        aria-valuemin={0}
        aria-valuemax={need}
        aria-valuenow={Math.min(have, need)}
        className="bg-border h-1 overflow-hidden rounded-full"
      >
        <div className="bg-status-pending-fg h-full rounded-full" style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}

/** The transaction, short enough to sit in a column, whole when copied. */
function TxHash({ hash }: { hash: string }) {
  const short = hash.length > 14 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
  return (
    <span className="text-muted-foreground inline-flex items-center gap-0.5 font-mono text-[12px]">
      <span title={hash}>{short}</span>
      <CopyButton value={hash} label="Copy the transaction hash" />
    </span>
  );
}

/** Home's few lines: what, when, how much, and where it has got to. */
export function ActivityBrief({ items }: { items: readonly Activity[] }) {
  return (
    <ul className="divide-border divide-y">
      {items.map((item) => {
        const incoming = item.direction === "in";
        const Arrow = incoming ? ArrowDown : ArrowUp;
        return (
          <li key={item.id} className="flex items-center justify-between gap-3 py-3 first:pt-1">
            <div className="min-w-0">
              <p className="text-foreground flex items-center gap-2 text-sm font-medium">
                <Arrow
                  size={15}
                  weight="bold"
                  aria-hidden="true"
                  className="text-muted-foreground"
                />
                {incoming ? "Deposit" : "Withdrawal"}
              </p>
              <p className="text-muted-foreground mt-0.5 text-[12px] tabular-nums">
                {when.format(new Date(item.at))}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <p
                className={cn(
                  "font-mono text-sm font-medium",
                  incoming ? "text-status-complete-fg" : "text-foreground",
                )}
              >
                {incoming ? "+" : "−"}
                <Amount value={item.amount} unit={null} />
              </p>
              <StatusPill status={item.tone}>{item.words}</StatusPill>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Calling a withdrawal off while nothing has been done to it yet. The hold is released. */
export function CancelWithdrawal({ id, onCancelled }: { id: string; onCancelled: () => void }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(null);
          const result = await walletClient.cancel(id);
          setBusy(false);
          if (result.ok) {
            toast.success("Withdrawal cancelled", {
              description: "The amount is back in your available balance.",
            });
            onCancelled();
          } else {
            setFailed(result.message);
            toastFailure(result);
            // Approved, or sent, while the list was open: show where it has got to.
            if (result.code === "CONFLICT") onCancelled();
          }
        }}
      >
        {busy ? "Cancelling…" : "Cancel"}
      </Button>
      {failed ? (
        <p role="alert" className="text-destructive mt-1.5 text-[12px]">
          {failed}
        </p>
      ) : null}
    </>
  );
}
