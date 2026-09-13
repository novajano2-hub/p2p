"use client";

import { CheckCircle, Warning, WarningCircle } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

import { ActionButton } from "@/components/admin/admin-shell";
import { CustomerPicker } from "@/components/admin/customer-picker";
import { Field, Textarea } from "@/components/ui/field";
import { depositsClient, type AdminCustomer, type AdminDeposit } from "@/lib/admin/operations";

/*
  The decision, and only when there is one to make.

  Two shapes, because the two queues ask different questions. A held deposit
  is credit-or-not: approving needs no explanation, rejecting does. An
  unattributed one is whose-is-this, and the answer must be a named customer
  plus the evidence for saying so - typed, kept, and shown back on this screen
  afterwards. Neither can be undone from here, so both say so before the
  button rather than after it.
*/

const MINIMUM = 3;

export function DepositDecision({
  deposit,
  onDecided,
}: {
  deposit: AdminDeposit;
  onDecided: (deposit: AdminDeposit) => void;
}) {
  const [reason, setReason] = useState("");
  /*
    Starts on whoever the address was issued to, when there is one. The picker
    and the button must always name the same person: an administrator who
    searched, found nothing, and pressed the button should not discover
    afterwards that it credited somebody else. "Change" clears it back to a
    search.
  */
  const [picked, setPicked] = useState<AdminCustomer | null>(deposit.customer);
  const [error, setError] = useState<string | null>(null);

  if (deposit.status === "MANUAL_REVIEW") {
    return (
      <section className="flex flex-col gap-4">
        <h2 className="text-foreground text-[15px] font-semibold">Decision</h2>
        {error ? (
          <p role="alert" className="text-destructive text-[13px]">
            {error}
          </p>
        ) : null}

        <Field
          label="Why"
          hint="Required to reject. Kept either way, and never shown to the customer."
        >
          {(a11y) => (
            <Textarea
              {...a11y}
              value={reason}
              placeholder="What you checked, and what you concluded."
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>

        <Card
          tone="approve"
          title="Credit it"
          body="The balance goes up by the full amount, exactly as it would have without the hold."
        >
          <ActionButton
            label="Approve"
            busyLabel="Crediting…"
            className="w-full"
            onRun={async () => {
              setError(null);
              const result = await depositsClient.approve(deposit.id, reason.trim());
              if (result.ok) onDecided(result.deposit);
              else setError(result.message);
            }}
          />
        </Card>

        <Card
          tone="reject"
          title="Do not credit it"
          body="The deposit is parked. The coins stay where they are and no balance changes."
        >
          <ActionButton
            label="Reject"
            busyLabel="Rejecting…"
            variant="destructive"
            className="w-full"
            disabled={reason.trim().length < MINIMUM}
            onRun={async () => {
              setError(null);
              const result = await depositsClient.reject(deposit.id, reason.trim());
              if (result.ok) onDecided(result.deposit);
              else setError(result.message);
            }}
          />
        </Card>

        <Final />
      </section>
    );
  }

  if (deposit.status !== "UNATTRIBUTED") return null;

  /*
    The coins are only ours to give away if JE-10a booked them when they
    arrived. Without that posting the transfer never reached an address we
    control, and there is nothing here to attribute to anybody - so the screen
    says so rather than offering a button the API would refuse.
  */
  if (!deposit.ledgerTransactionId) {
    return (
      <section className="rounded-surface border-border bg-surface border px-4 py-4">
        <h2 className="text-foreground text-[15px] font-semibold">Nothing to attribute</h2>
        <p className="text-muted-foreground mt-1.5 text-[13px] leading-relaxed">
          This transfer never reached an address of ours, so no coins were booked and there is
          nothing to give anybody. It is recorded only so that the same transaction is not read
          twice.
        </p>
      </section>
    );
  }

  const suggestion = deposit.customer;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-foreground text-[15px] font-semibold">Whose is it</h2>
      {error ? (
        <p role="alert" className="text-destructive text-[13px]">
          {error}
        </p>
      ) : null}

      {suggestion && picked?.userId === suggestion.userId ? (
        <div className="rounded-surface border-primary/30 bg-primary/5 border px-4 py-3.5">
          <p className="text-foreground text-[13px] font-medium">
            This address was issued to a customer
          </p>
          <p className="text-muted-foreground mt-1 text-[12px] leading-relaxed">
            It landed on an address of ours that we gave to{" "}
            <span className="font-mono">{suggestion.platformId}</span> ({suggestion.username}). It
            was not credited automatically because the address or the account was not accepting
            deposits at the time. Check why before attributing it.
          </p>
        </div>
      ) : null}

      <CustomerPicker picked={picked} onPick={setPicked} />

      <Field label="Evidence" hint="What makes you sure it is theirs. Kept with the entry.">
        {(a11y) => (
          <Textarea
            {...a11y}
            value={reason}
            placeholder="The address was issued to this account on…; the customer quoted this transaction hash in ticket…"
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </Field>

      <Card
        tone="approve"
        title={picked ? `Credit ${picked.platformId}` : "Credit a customer"}
        body="The coins move out of the unidentified-deposits liability and into their balance. What we owe customers rises by exactly this much."
      >
        <ActionButton
          label="Attribute"
          busyLabel="Attributing…"
          className="w-full"
          disabled={!picked || reason.trim().length < MINIMUM}
          onRun={async () => {
            if (!picked) return;
            setError(null);
            const result = await depositsClient.attribute(deposit.id, picked.userId, reason.trim());
            if (result.ok) onDecided(result.deposit);
            else setError(result.message);
          }}
        />
      </Card>

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
      Recorded against your account, and posted to the ledger where it moves money. A deposit can
      only be decided once.
    </p>
  );
}
