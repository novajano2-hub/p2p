"use client";

import { useState } from "react";

import { CopyButton } from "@/components/app/copy-button";
import { Panel } from "@/components/app/panel";
import { FormError } from "@/components/auth/notices";
import { ConfirmButton, birr, dateTime, usdt } from "@/components/market/bits";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { Note, SummaryRow } from "@/components/wallet/shared";
import { marketClient, type PaymentInstructions, type Trade } from "@/lib/market/client";
import { ASSET, FIAT, PAYMENT_KINDS } from "@/lib/market/labels";
import { formatSantim } from "@/lib/market/money";

/*
  The one panel that changes with who is looking and where the trade is.
  A buyer waiting to pay sees where to pay and the button that says they
  have; a seller waiting sees the buyer's word and the button that lets the
  USDT go, behind their password. Everything else is a sentence about what
  is being waited for. The buttons come from the server's `actions`, never
  from a status the browser worked out.
*/

export function PaymentPanel({
  trade,
  expired,
  onUpdated,
}: {
  trade: Trade;
  expired: boolean;
  onUpdated: (trade: Trade) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const buying = trade.role === "BUYER";
  const other = trade.counterparty.username;

  return (
    <Panel title={buying ? "Payment" : "Release"}>
      <FormError message={error} />

      {trade.message ? (
        <p className="text-foreground mb-4 text-sm leading-relaxed">{trade.message}</p>
      ) : null}

      {buying && trade.actions.canMarkPaid && trade.payment.instructions ? (
        <PayNow trade={trade} expired={expired} onUpdated={onUpdated} onError={setError} />
      ) : null}

      {trade.actions.canRelease ? (
        <ReleaseNow trade={trade} onUpdated={onUpdated} onError={setError} />
      ) : null}

      {!buying && trade.status === "AWAITING_FIAT_PAYMENT" ? (
        <Note>
          {other} has been shown your {PAYMENT_KINDS[trade.payment.kind].label} details ({trade.payment.label}) and has until the timer runs out to send {birr(trade.fiatSantim)}. Nothing to do until they say they have paid.
        </Note>
      ) : null}

      <dl className="divide-border mt-5 divide-y">
        <SummaryRow label={buying ? "You receive" : "You give"}>{usdt(buying ? trade.buyerReceives : trade.amount)}</SummaryRow>
        {trade.fee !== "0" ? <SummaryRow label="Fee">{usdt(trade.fee)}</SummaryRow> : null}
        <SummaryRow label={buying ? "You pay" : "You receive"} strong>{birr(trade.fiatSantim)}</SummaryRow>
        <SummaryRow label="Price">{formatSantim(trade.priceSantim)} {FIAT} per {ASSET}</SummaryRow>
        <SummaryRow label="Payment method">{trade.payment.label}</SummaryRow>
        {trade.payment.reference ? <SummaryRow label="Transfer reference">{trade.payment.reference}</SummaryRow> : null}
        {trade.paidAt ? <SummaryRow label="Marked paid">{dateTime(trade.paidAt)}</SummaryRow> : null}
        {trade.closedAt ? <SummaryRow label="Closed">{dateTime(trade.closedAt)}</SummaryRow> : null}
        {trade.closeReason ? <SummaryRow label="Reason">{trade.closeReason}</SummaryRow> : null}
        <SummaryRow label="Trade">
          <span className="inline-flex items-center gap-1">
            <span className="font-mono text-[12px]">{trade.id.slice(0, 8)}…{trade.id.slice(-4)}</span>
            <CopyButton value={trade.id} label="Copy trade id" />
          </span>
        </SummaryRow>
      </dl>

      {trade.actions.canCancel ? (
        <div className="mt-5">
          <CancelTrade trade={trade} onUpdated={onUpdated} onError={setError} />
        </div>
      ) : null}
    </Panel>
  );
}

/* --------------------------------------------------------------- buyer */

function PayNow({
  trade,
  expired,
  onUpdated,
  onError,
}: {
  trade: Trade;
  expired: boolean;
  onUpdated: (trade: Trade) => void;
  onError: (message: string | null) => void;
}) {
  const [reference, setReference] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const instructions = trade.payment.instructions as PaymentInstructions;

  const rows = detailRows(instructions);

  const paid = async () => {
    onError(null);
    setBusy(true);
    const result = await marketClient.markPaid(trade.id, reference.trim());
    setBusy(false);
    if (!result.ok) {
      onError(result.message);
      setConfirming(false);
      return;
    }
    onUpdated(result.trade);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="border-border rounded-surface border">
        <div className="border-border flex items-baseline justify-between gap-4 border-b px-4 py-3">
          <span className="text-muted-foreground text-[13px]">Send exactly</span>
          <span className="inline-flex items-center gap-1">
            <span className="text-foreground font-sans text-2xl font-bold tracking-tight tabular-nums">
              {formatSantim(trade.fiatSantim)}
            </span>
            <span className="text-muted-foreground text-sm font-medium">{FIAT}</span>
            <CopyButton value={(BigInt(trade.fiatSantim) / 100n).toString() + (BigInt(trade.fiatSantim) % 100n === 0n ? "" : `.${(BigInt(trade.fiatSantim) % 100n).toString().padStart(2, "0")}`)} label="Copy the amount" />
          </span>
        </div>
        <dl className="divide-border divide-y px-4">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 py-2.5">
              <dt className="text-muted-foreground shrink-0 text-[13px]">{row.label}</dt>
              <dd className="text-foreground flex min-w-0 items-center gap-1 text-right text-[15px] font-medium">
                <span className={row.mono ? "font-mono tabular-nums" : ""}>{row.value}</span>
                {row.copy ? <CopyButton value={row.value} label={`Copy ${row.label.toLowerCase()}`} /> : null}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <Note>
        Pay from an account in your own name, and write nothing about crypto in the transfer note. The seller releases once the money shows in their account.
      </Note>

      {expired ? (
        <p role="status" className="text-status-attention-fg text-[13px] font-medium">
          The time to pay has run out. If you have not sent anything, do not send it now.
        </p>
      ) : null}

      <Field label="Transfer reference" hint="Optional. What your bank or wallet called the transfer, so the seller can find it.">
        {(control) => (
          <Input {...control} value={reference} onChange={(event) => setReference(event.target.value)} maxLength={80} autoComplete="off" />
        )}
      </Field>

      {confirming ? (
        <div className="bg-muted rounded-control flex flex-col gap-3 px-4 py-3">
          <p className="text-foreground text-sm font-medium">
            Has {birr(trade.fiatSantim)} left your account? Only press this once it has; the seller is told at once.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="md" loading={busy} onClick={paid}>
              Yes, I have paid
            </Button>
            <Button type="button" variant="ghost" size="md" onClick={() => setConfirming(false)}>
              Not yet
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" size="lg" className="w-full" onClick={() => setConfirming(true)}>
          I have paid
        </Button>
      )}
    </div>
  );
}

function detailRows(instructions: PaymentInstructions): { label: string; value: string; copy: boolean; mono: boolean }[] {
  const kind = PAYMENT_KINDS[instructions.kind];
  const rows = [{ label: kind.label === "Bank transfer" ? "Bank" : "Pay through", value: instructions.bankName ?? kind.label, copy: false, mono: false }];
  rows.push({ label: kind.numberLabel, value: instructions.accountNumber, copy: true, mono: true });
  rows.push({ label: "Name on the account", value: instructions.accountHolder, copy: true, mono: false });
  if (instructions.branch) rows.push({ label: "Branch", value: instructions.branch, copy: false, mono: false });
  return rows;
}

function CancelTrade({
  trade,
  onUpdated,
  onError,
}: {
  trade: Trade;
  onUpdated: (trade: Trade) => void;
  onError: (message: string | null) => void;
}) {
  return (
    <ConfirmButton
      question="Cancel this trade? The seller's USDT goes back to them."
      confirmLabel="Cancel the trade"
      variant="ghost"
      onConfirm={async () => {
        onError(null);
        const result = await marketClient.cancelTrade(trade.id, "");
        if (!result.ok) {
          onError(result.message);
          return;
        }
        onUpdated(result.trade);
      }}
    >
      Cancel trade
    </ConfirmButton>
  );
}

/* -------------------------------------------------------------- seller */

function ReleaseNow({
  trade,
  onUpdated,
  onError,
}: {
  trade: Trade;
  onUpdated: (trade: Trade) => void;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const release = async () => {
    if (!password) {
      setProblem("Enter your password to confirm.");
      return;
    }
    onError(null);
    setProblem(null);
    setBusy(true);
    const result = await marketClient.releaseTrade(trade.id, password);
    setBusy(false);
    if (!result.ok) {
      if (result.code === "VALIDATION") setProblem(result.message);
      else onError(result.message);
      return;
    }
    setPassword("");
    setOpen(false);
    onUpdated(result.trade);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-status-pending text-status-pending-fg rounded-control px-4 py-3 text-[13px] leading-relaxed">
        <strong className="font-semibold">Check your {trade.payment.label} first.</strong> Release only when {birr(trade.fiatSantim)} is actually in your account, from a payer named {trade.counterparty.username} or as agreed in the chat. A screenshot is not a payment. Releasing cannot be undone.
      </div>
      {open ? (
        <div className="flex flex-col gap-3">
          <Field label="Your password" hint="Asked every time you release: this is the moment the USDT leaves you." error={problem ?? undefined}>
            {(control) => (
              <PasswordInput
                {...control}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void release();
                  }
                }}
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="md" loading={busy} onClick={release}>
              Release {usdt(trade.buyerReceives)}
            </Button>
            <Button type="button" variant="ghost" size="md" onClick={() => setOpen(false)}>
              Not yet
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" size="lg" className="w-full" onClick={() => setOpen(true)}>
          Release {ASSET} to {trade.counterparty.username}
        </Button>
      )}
    </div>
  );
}
