"use client";

import { CheckCircle, Warning, WarningCircle } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

import { ActionButton } from "@/components/admin/admin-shell";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Radio } from "@/components/ui/radio";
import { withdrawalsClient, type AdminWithdrawal } from "@/lib/admin/operations";

/*
  Authorising money to leave, or saying what became of money that may already
  have left.

  The second is the one to be careful with. When custody could not tell us
  whether a transfer reached the chain, there are exactly two truths and they
  have opposite consequences: it is out there, in which case we record the
  transaction and settle it; or nothing was ever sent, in which case the
  customer gets their money back. Software must never guess between them and
  never retry (ADR-0010), so the choice is a person's, made against a block
  explorer, and the screen states the consequence of each before it is made.
*/

const MINIMUM = 3;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export function WithdrawalDecision({
  withdrawal,
  onDecided,
}: {
  withdrawal: AdminWithdrawal;
  onDecided: (withdrawal: AdminWithdrawal) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"BROADCAST" | "FAILED" | null>(null);
  const [txHash, setTxHash] = useState("");

  if (withdrawal.status === "RISK_REVIEW") {
    const signed = withdrawal.approvals.length;
    const remaining = Math.max(withdrawal.approvalsRequired - signed, 0);
    return (
      <section className="flex flex-col gap-4">
        <h2 className="text-foreground text-[15px] font-semibold">Decision</h2>
        {error ? (
          <p role="alert" className="text-destructive text-[13px]">
            {error}
          </p>
        ) : null}

        <Field label="Why" hint="Required to reject. Kept with your approval either way.">
          {(a11y) => (
            <Textarea
              {...a11y}
              value={reason}
              placeholder="What you checked about this account and this destination."
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>

        <Card
          tone="approve"
          title={remaining > 1 ? "Approve (one of several)" : "Approve and send"}
          body={
            remaining > 1
              ? `Your approval is recorded. ${remaining - 1} more will be needed before anything is built or sent.`
              : "The transfer is queued to be built, signed and broadcast. It cannot be recalled once it is on the chain."
          }
        >
          <ActionButton
            label="Approve"
            busyLabel="Approving…"
            className="w-full"
            onRun={async () => {
              setError(null);
              const result = await withdrawalsClient.approve(withdrawal.id, reason.trim());
              if (result.ok) onDecided(result.withdrawal);
              else setError(result.message);
            }}
          />
        </Card>

        <Card
          tone="reject"
          title="Reject and return it"
          body="The hold is released and the money goes back to the customer's available balance. They are told it was not approved."
        >
          <ActionButton
            label="Reject"
            busyLabel="Rejecting…"
            variant="destructive"
            className="w-full"
            disabled={reason.trim().length < MINIMUM}
            onRun={async () => {
              setError(null);
              const result = await withdrawalsClient.reject(withdrawal.id, reason.trim());
              if (result.ok) onDecided(result.withdrawal);
              else setError(result.message);
            }}
          />
        </Card>

        <Final />
      </section>
    );
  }

  if (withdrawal.status !== "MANUAL_INVESTIGATION") return null;

  const hashValid = TX_HASH.test(txHash.trim());
  const ready =
    reason.trim().length >= MINIMUM && (outcome === "BROADCAST" ? hashValid : outcome === "FAILED");

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-foreground text-[15px] font-semibold">What actually happened</h2>

      <div className="rounded-surface border-status-attention-fg/25 bg-status-attention/25 border px-4 py-3.5">
        <p className="text-foreground text-[13px] font-medium">Check the chain, not the provider</p>
        <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">
          Custody could not tell us whether this reached the chain. Search the destination address
          on a block explorer and decide from what is there. Do not decide from a support reply.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-[13px]">
          {error}
        </p>
      ) : null}

      <div role="radiogroup" aria-label="Outcome" className="flex flex-col gap-2.5">
        <Radio
          name="outcome"
          value="BROADCAST"
          checked={outcome === "BROADCAST"}
          onChange={() => setOutcome("BROADCAST")}
          label="It is on the chain"
          description="I found the transaction. Record it and let it settle normally."
        />
        <Radio
          name="outcome"
          value="FAILED"
          checked={outcome === "FAILED"}
          onChange={() => setOutcome("FAILED")}
          label="Nothing was ever sent"
          description="No such transaction exists. Release the hold and give the money back."
        />
      </div>

      {outcome === "BROADCAST" ? (
        <Field
          label="Transaction hash"
          hint="Exactly as the explorer shows it."
          error={txHash.trim() && !hashValid ? "That is not a transaction hash." : undefined}
        >
          {(a11y) => (
            <Input
              {...a11y}
              value={txHash}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-[13px]"
              onChange={(event) => setTxHash(event.target.value)}
            />
          )}
        </Field>
      ) : null}

      {outcome === "FAILED" ? (
        <div className="rounded-surface border-destructive/30 bg-destructive/5 border px-4 py-3.5">
          <p className="text-foreground text-[13px] font-medium">
            This one gives money back. Be certain.
          </p>
          <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">
            If the transfer did reach the chain after all, the customer will have been paid twice
            and the shortfall will show up at the next reconciliation. Nothing else in the system
            can catch this mistake before then.
          </p>
        </div>
      ) : null}

      <Field label="What you found" hint="Where you looked and what you saw. Kept permanently.">
        {(a11y) => (
          <Textarea
            {...a11y}
            value={reason}
            placeholder="Searched the destination on BscScan at…; the only transfer to this address was…"
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </Field>

      <ActionButton
        label="Record what happened"
        busyLabel="Recording…"
        variant={outcome === "FAILED" ? "destructive" : "primary"}
        className="w-full"
        disabled={!ready}
        onRun={async () => {
          if (!outcome) return;
          setError(null);
          const result = await withdrawalsClient.resolve(withdrawal.id, {
            outcome,
            ...(outcome === "BROADCAST" ? { txHash: txHash.trim() } : {}),
            reason: reason.trim(),
          });
          if (result.ok) onDecided(result.withdrawal);
          else setError(result.message);
        }}
      />

      <Final />
    </section>
  );
}

function Card({
  tone,
  title,
  body,
  children,
}: {
  tone: "approve" | "reject";
  title: string;
  body: string;
  children: ReactNode;
}) {
  const approve = tone === "approve";
  const Icon = approve ? CheckCircle : WarningCircle;
  return (
    <div
      className={
        approve
          ? "rounded-surface border-status-complete-fg/25 bg-status-complete/40 flex flex-col gap-3 border px-4 py-4"
          : "rounded-surface border-status-attention-fg/25 bg-status-attention/30 flex flex-col gap-3 border px-4 py-4"
      }
    >
      <div className="flex items-start gap-2.5">
        <Icon
          size={18}
          weight="fill"
          aria-hidden="true"
          className={
            approve
              ? "text-status-complete-fg mt-0.5 shrink-0"
              : "text-status-attention-fg mt-0.5 shrink-0"
          }
        />
        <div className="min-w-0">
          <p className="text-foreground text-[14px] font-medium">{title}</p>
          <p className="text-muted-foreground mt-0.5 text-[12px] leading-relaxed">{body}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function Final() {
  return (
    <p className="text-muted-foreground flex items-start gap-2 text-[12px] leading-relaxed">
      <Warning size={14} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
      Recorded against your account with what you typed, and posted to the ledger where it moves
      money.
    </p>
  );
}
