"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";

import { CopyButton, CopyTextButton } from "@/components/app/copy-button";
import { Panel } from "@/components/app/panel";
import { FormError } from "@/components/auth/notices";
import { birr, dateTime, usdt } from "@/components/market/bits";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { Note, SummaryRow } from "@/components/wallet/shared";
import { cn } from "@/lib/cn";
import { marketClient, type PaymentInstructions, type Trade } from "@/lib/market/client";
import { releaseForm, type ReleaseForm } from "@/lib/market/forms";
import { ASSET, FIAT, PAYMENT_KINDS } from "@/lib/market/labels";
import { formatSantim } from "@/lib/market/money";
import { figureLabels } from "@/lib/market/orders";
import { placeOnField, revealProblems } from "@/lib/reveal-problems";
import { notificationKey, toast, toastFailure, type Refusal } from "@/lib/toast";

/*
  The part of an order that changes with who is looking and where it stands.
  A buyer waiting to pay sees where to pay - every detail with its own Copy
  button, the amount included - and the button that says they have; a seller
  who has been told sees the rule for releasing and the button that lets the
  USDT go, behind their password. The buttons come from the server's
  `actions`, never from a status the browser worked out.

  Each button says what it did, as a toast. A refusal is said as a toast and
  kept at the top of the card; a wrong password is said on the password.

  On a phone the buyer's two buttons are pinned above the tab bar, so "I have
  paid" is there after the scroll down to the account number and back up to
  the bank app.
*/

export function PaymentPanel({
  trade,
  expired,
  onUpdated,
  onConflict,
}: {
  trade: Trade;
  expired: boolean;
  onUpdated: (trade: Trade) => void;
  /** An action refused as out of date: the page looks again and says what the order is now. */
  onConflict?: ((refusal: Refusal) => Promise<void>) | undefined;
}) {
  const [error, setShownError] = useState<string | null>(null);
  const setError = useCallback(
    (refusal: Refusal | null) => {
      if (refusal?.code === "CONFLICT" && onConflict) {
        setShownError(null);
        void onConflict(refusal);
        return;
      }
      setShownError(refusal?.message ?? null);
      if (refusal) toastFailure(refusal);
    },
    [onConflict],
  );

  const paying = trade.role === "BUYER" && trade.actions.canMarkPaid && trade.payment.instructions;
  if (!paying && !trade.actions.canRelease) return error ? <FormError message={error} /> : null;

  return (
    <>
      {paying ? (
        <PayNow
          trade={trade}
          expired={expired}
          error={error}
          onUpdated={onUpdated}
          onError={setError}
        />
      ) : (
        <ReleaseNow trade={trade} error={error} onUpdated={onUpdated} onError={setError} />
      )}
    </>
  );
}

/* --------------------------------------------------------------- buyer */

/** The amount to send, as a bank app wants it typed: "1000", "1000.50" - no grouping, no zeros for show. */
function plainAmount(santim: string): string {
  const value = BigInt(santim);
  const cents = value % 100n;
  return (value / 100n).toString() + (cents === 0n ? "" : `.${cents.toString().padStart(2, "0")}`);
}

function PayNow({
  trade,
  expired,
  error,
  onUpdated,
  onError,
}: {
  trade: Trade;
  expired: boolean;
  error: string | null;
  onUpdated: (trade: Trade) => void;
  onError: (refusal: Refusal | null) => void;
}) {
  const [reference, setReference] = useState("");
  const [asking, setAsking] = useState<"paid" | "cancel" | null>(null);
  const [busy, setBusy] = useState(false);
  const instructions = trade.payment.instructions as PaymentInstructions;
  const kind = PAYMENT_KINDS[instructions.kind];

  const paid = async () => {
    onError(null);
    setBusy(true);
    const result = await marketClient.markPaid(trade.id, reference.trim());
    setBusy(false);
    if (!result.ok) {
      onError(result);
      setAsking(null);
      return;
    }
    toast.success("Marked as paid", {
      description: `${trade.counterparty.username} has been told. They release once the money shows in their account.`,
    });
    onUpdated(result.trade);
  };

  const cancel = async () => {
    onError(null);
    setBusy(true);
    const result = await marketClient.cancelTrade(trade.id, "");
    setBusy(false);
    if (!result.ok) {
      onError(result);
      setAsking(null);
      return;
    }
    toast.success("Order cancelled", {
      description: "The seller's USDT went back to them. Do not send any money now.",
    });
    onUpdated(result.trade);
  };

  return (
    <section
      aria-label="Payment"
      className="rounded-surface border-border bg-surface shadow-panel flex min-w-0 flex-col gap-4 border px-5 py-5 sm:px-6"
    >
      <FormError message={error} />
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-foreground text-base font-semibold">Pay with</h2>
        <span className="text-foreground flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden="true" className={cn("h-3.5 w-[3px] rounded-full", kind.bar)} />
          {kind.label}
        </span>
      </div>

      <div className="bg-muted rounded-surface flex items-center justify-between gap-3 px-4 py-3.5">
        <div className="min-w-0">
          <p className="text-muted-foreground text-[12px] font-medium">Send exactly</p>
          <p>
            <span className="text-foreground font-mono text-[1.625rem] leading-tight font-medium tabular-nums">
              {formatSantim(trade.fiatSantim)}
            </span>{" "}
            <span className="text-muted-foreground text-[13px]">{FIAT}</span>
          </p>
        </div>
        <CopyTextButton
          value={plainAmount(trade.fiatSantim)}
          label="Copy the amount"
          className="bg-surface"
        />
      </div>

      <dl className="divide-border divide-y">
        {kind.institution === "bank" ? (
          <div className="py-3">
            <dt className="text-muted-foreground text-[12px] font-medium">Bank</dt>
            <dd className="text-foreground text-[15px] font-semibold">{kind.fullName}</dd>
          </div>
        ) : null}
        <DetailRow label="Name on the account" value={instructions.accountHolder} />
        <DetailRow label={kind.numberLabel} value={instructions.accountNumber} mono />
      </dl>

      <Note>
        Pay from an account in your own name, and write nothing about crypto in the transfer note.
        The seller releases once the money shows in their account.
      </Note>

      {expired ? (
        <p role="status" className="text-status-attention-fg text-[13px] font-medium">
          The time to pay has run out. If you have not sent anything, do not send it now.
        </p>
      ) : null}

      <Field
        label="Transfer reference"
        hint="Optional. What your bank or wallet called the transfer, so the seller can find it."
      >
        {(control) => (
          <Input
            {...control}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            maxLength={80}
            autoComplete="off"
          />
        )}
      </Field>

      {/* In the card on a desk; pinned above the tab bar on a phone. */}
      <div className="max-lg:border-border max-lg:bg-surface max-lg:fixed max-lg:inset-x-0 max-lg:bottom-[calc(4rem+env(safe-area-inset-bottom))] max-lg:z-30 max-lg:border-t max-lg:px-4 max-lg:py-3">
        {asking === "paid" ? (
          <div className="flex flex-col gap-3">
            <p className="text-foreground text-sm font-medium">
              Has {birr(trade.fiatSantim)} left your account? Only press this once it has; the
              seller is told at once.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="md" loading={busy} onClick={paid}>
                Yes, I have paid
              </Button>
              <Button type="button" variant="ghost" size="md" onClick={() => setAsking(null)}>
                Not yet
              </Button>
            </div>
          </div>
        ) : asking === "cancel" ? (
          <div className="flex flex-col gap-3">
            <p className="text-foreground text-sm font-medium">
              Cancel this order? The seller&apos;s {ASSET} goes back to them. Do not cancel if you
              have already paid.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="destructive" size="md" loading={busy} onClick={cancel}>
                Cancel the order
              </Button>
              <Button type="button" variant="ghost" size="md" onClick={() => setAsking(null)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 lg:flex-row-reverse lg:gap-3">
            {trade.actions.canCancel ? (
              <Button
                type="button"
                variant="secondary"
                size="lg"
                className="lg:text-muted-foreground lg:border-transparent lg:bg-transparent lg:shadow-none"
                onClick={() => setAsking("cancel")}
              >
                Cancel order
              </Button>
            ) : null}
            <Button type="button" size="lg" className="flex-1" onClick={() => setAsking("paid")}>
              I have paid
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

/** One thing to carry into the bank app: what it is, the value, and its own Copy button. */
function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <dt className="text-muted-foreground text-[12px] font-medium">{label}</dt>
        <dd
          className={cn(
            "text-foreground text-[15px] font-semibold [overflow-wrap:anywhere]",
            mono && "font-mono tabular-nums",
          )}
        >
          {value}
        </dd>
      </div>
      <CopyTextButton value={value} label={`Copy the ${label.toLowerCase()}`} />
    </div>
  );
}

/* -------------------------------------------------------------- seller */

function ReleaseNow({
  trade,
  error,
  onUpdated,
  onError,
}: {
  trade: Trade;
  error: string | null;
  onUpdated: (trade: Trade) => void;
  onError: (refusal: Refusal | null) => void;
}) {
  const [formElement, setFormElement] = useState<HTMLFormElement | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ReleaseForm>({
    resolver: zodResolver(releaseForm),
    defaultValues: { password: "" },
    shouldFocusError: false,
  });

  const release = handleSubmit(
    async ({ password }) => {
      onError(null);
      const result = await marketClient.releaseTrade(trade.id, password);
      if (!result.ok) {
        if (!placeOnField(result, { password: "password" }, setError, formElement)) {
          onError(result);
        }
        return;
      }
      toast.success(`${ASSET} released`, {
        description: `${usdt(trade.buyerReceives)} went to ${trade.counterparty.username}. The order is complete.`,
        // The server tells this account "USDT sent" too, for its other devices:
        // this tab has said it already.
        covers: notificationKey("TRADE_RELEASED", `/orders/${trade.id}`),
      });
      reset();
      onUpdated(result.trade);
    },
    () => revealProblems(formElement),
  );

  return (
    <section
      aria-label="Release"
      className="rounded-surface border-border bg-surface shadow-panel flex min-w-0 flex-col gap-4 border px-5 py-5 sm:px-6"
    >
      <FormError message={error} />
      <h2 className="font-display text-foreground text-base font-semibold">Release</h2>
      <p className="text-foreground text-sm leading-relaxed">
        Release only when <strong className="font-semibold">{birr(trade.fiatSantim)}</strong> is
        actually in your {trade.payment.label}, from a payer named{" "}
        <strong className="font-semibold">{trade.counterparty.username}</strong> or as agreed in the
        chat. A screenshot is not a payment. Releasing cannot be undone.
      </p>
      <form ref={setFormElement} noValidate onSubmit={release} className="flex flex-col gap-4">
        <Field
          label="Your password"
          hint="Asked every time you release: this is the moment the USDT leaves you."
          error={errors.password?.message}
        >
          {(a11y) => (
            <PasswordInput {...a11y} {...register("password")} autoComplete="current-password" />
          )}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Release {usdt(trade.buyerReceives)}
        </Button>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------- details */

/** The order in figures and dates: the record, under the part that asks for something. */
export function OrderDetails({ trade }: { trade: Trade }) {
  const buying = trade.role === "BUYER";
  const labels = figureLabels(trade);
  return (
    <Panel title="Order details">
      <dl className="divide-border -my-1 divide-y">
        <SummaryRow label={labels.usdt}>
          {usdt(buying ? trade.buyerReceives : trade.amount)}
        </SummaryRow>
        {trade.fee !== "0" ? <SummaryRow label="Fee">{usdt(trade.fee)}</SummaryRow> : null}
        <SummaryRow label={labels.fiat} strong>
          {birr(trade.fiatSantim)}
        </SummaryRow>
        <SummaryRow label="Price">
          {formatSantim(trade.priceSantim)} {FIAT} per {ASSET}
        </SummaryRow>
        <SummaryRow label="Payment method">{trade.payment.label}</SummaryRow>
        {trade.payment.reference ? (
          <SummaryRow label="Transfer reference">
            <span className="font-mono tabular-nums">{trade.payment.reference}</span>
          </SummaryRow>
        ) : null}
        <SummaryRow label="Opened">{dateTime(trade.createdAt)}</SummaryRow>
        {trade.paidAt ? (
          <SummaryRow label="Marked paid">{dateTime(trade.paidAt)}</SummaryRow>
        ) : null}
        {trade.closedAt ? <SummaryRow label="Closed">{dateTime(trade.closedAt)}</SummaryRow> : null}
        {trade.closeReason ? <SummaryRow label="Reason">{trade.closeReason}</SummaryRow> : null}
        <SummaryRow label="Order">
          <span className="inline-flex items-center gap-1">
            <span className="font-mono text-[12px]">
              {trade.id.slice(0, 8)}…{trade.id.slice(-4)}
            </span>
            <CopyButton value={trade.id} label="Copy the order number" />
          </span>
        </SummaryRow>
      </dl>
    </Panel>
  );
}
