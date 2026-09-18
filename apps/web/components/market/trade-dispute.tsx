"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { Panel } from "@/components/app/panel";
import { FormError } from "@/components/auth/notices";
import { ConfirmButton, dateTime, timeAgo, usdt } from "@/components/market/bits";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Radio, RadioGroup } from "@/components/ui/radio";
import { StatusPill } from "@/components/ui/status-pill";
import { Note } from "@/components/wallet/shared";
import { cn } from "@/lib/cn";
import { pickImage } from "@/lib/image";
import { marketClient, type Dispute, type Trade } from "@/lib/market/client";
import { DISPUTE_DESCRIPTION_MAX, disputeForm, type DisputeForm } from "@/lib/market/forms";
import { DISPUTE_REASONS, DISPUTE_REASONS_FOR } from "@/lib/market/labels";
import { revealProblems } from "@/lib/reveal-problems";
import { toast, toastFailure, type Refusal } from "@/lib/toast";

/*
  Asking a person to look: the Binance appeal, in the trade rather than on
  its own screen. Opening it is a reason and a few words; after that both
  sides attach what they have, the party who asked can take it back, and a
  reviewer's decision - with their note - ends it. The escrow never moves
  because of anything on this panel.

  The cooldown is the server's: the button appears when the server's
  `actions` say a dispute may be opened, and until then this panel says
  when that will be, from the moment the buyer marked paid.

  Every step says it happened, as a toast. A refusal is said twice: as a
  toast, where the person is looking, and at the top of this panel, where it
  stays.
*/

/** Mirrors TRADE_DISPUTE_COOLDOWN_MINUTES on the server, for the sentence only. The server is what refuses. */
const COOLDOWN_MINUTES = 10;

export function DisputePanel({
  trade,
  onUpdated,
  onConflict,
}: {
  trade: Trade;
  onUpdated: () => void;
  /** An action refused as out of date: the page looks again and says what the order is now. */
  onConflict?: ((refusal: Refusal) => Promise<void>) | undefined;
}) {
  const [dispute, setDispute] = useState<Dispute | null>(null);
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
  const [opening, setOpening] = useState(false);
  const summary = trade.dispute;

  /** The dispute in full, when the trade says there is one. Resolves once it is in state. */
  const load = useCallback(
    () =>
      marketClient.dispute(trade.id).then((result) => {
        if (result.ok) setDispute(result.dispute);
      }),
    [trade.id],
  );

  // Refetch whenever the trade's own summary of it changes.
  const summaryKey = summary ? `${summary.id}:${summary.status}:${summary.resolvedAt ?? ""}` : "";
  useEffect(() => {
    if (!summaryKey) return;
    void load();
  }, [load, summaryKey]);

  // Nothing to say on a trade that never got as far as a payment.
  if (!summary && !trade.actions.canDispute && trade.status !== "BUYER_MARKED_PAID") return null;

  const cooldownEndsAt = trade.paidAt
    ? new Date(new Date(trade.paidAt).getTime() + COOLDOWN_MINUTES * 60_000).toISOString()
    : null;

  return (
    <Panel title={summary ? "Dispute" : "Something wrong?"}>
      <FormError message={error} />

      {summary && dispute ? (
        <DisputeDetail
          trade={trade}
          dispute={dispute}
          onChanged={async () => {
            await load();
            onUpdated();
          }}
          onError={setError}
        />
      ) : summary ? (
        <p className="text-muted-foreground text-[13px]">Loading…</p>
      ) : null}

      {trade.actions.canDispute ? (
        opening ? (
          <OpenDispute
            trade={trade}
            onDone={() => {
              setOpening(false);
              onUpdated();
            }}
            onCancel={() => setOpening(false)}
            onError={setError}
          />
        ) : (
          <div className={cn("flex flex-col gap-3", summary && "mt-5")}>
            <p className="text-muted-foreground text-[13px] leading-relaxed">
              {trade.role === "BUYER"
                ? "Paid, and the seller is not releasing? A reviewer can look at the chat and your proof of payment and decide."
                : "Nothing arrived, the wrong amount, or a payment from somebody else's account? A reviewer can look and decide."}
            </p>
            <div>
              <Button type="button" variant="secondary" size="sm" onClick={() => setOpening(true)}>
                {summary ? "Open a new dispute" : "Open a dispute"}
              </Button>
            </div>
          </div>
        )
      ) : !summary && cooldownEndsAt ? (
        <Note>
          A transfer can take a few minutes to show. You can open a dispute from{" "}
          {dateTime(cooldownEndsAt)} if it still has not arrived.
        </Note>
      ) : null}
    </Panel>
  );
}

function OpenDispute({
  trade,
  onDone,
  onCancel,
  onError,
}: {
  trade: Trade;
  onDone: () => void;
  onCancel: () => void;
  onError: (refusal: Refusal | null) => void;
}) {
  const reasons = DISPUTE_REASONS_FOR[trade.role];
  const [formElement, setFormElement] = useState<HTMLFormElement | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DisputeForm>({
    resolver: zodResolver(disputeForm),
    defaultValues: { reason: reasons[0] ?? "OTHER", description: "" },
    shouldFocusError: false,
  });

  const submit = handleSubmit(
    async ({ reason, description }) => {
      onError(null);
      const result = await marketClient.openDispute(trade.id, { reason, description });
      if (!result.ok) {
        onError(result);
        return;
      }
      toast.success("Dispute opened", {
        description:
          "A reviewer reads the chat and the evidence from both of you. Attach what you have below.",
      });
      onDone();
    },
    () => revealProblems(formElement),
  );

  return (
    <form ref={setFormElement} noValidate className="mt-4 flex flex-col gap-4" onSubmit={submit}>
      <RadioGroup legend="What happened?" error={errors.reason?.message}>
        {reasons.map((value) => (
          <Radio key={value} value={value} label={DISPUTE_REASONS[value]} {...register("reason")} />
        ))}
      </RadioGroup>
      <Field
        label="Tell the reviewer"
        hint="What you did, when, and what you see. Attach screenshots after opening."
        error={errors.description?.message}
      >
        {(a11y) => (
          <Textarea
            {...a11y}
            {...register("description")}
            maxLength={DISPUTE_DESCRIPTION_MAX}
            rows={4}
          />
        )}
      </Field>
      <Note>
        The {usdt(trade.amount)} stays in escrow until a reviewer decides or the dispute is
        withdrawn. Both of you can add evidence, and the reviewer reads the chat.
      </Note>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="md" loading={isSubmitting}>
          Open the dispute
        </Button>
        <Button type="button" variant="ghost" size="md" onClick={onCancel}>
          Back
        </Button>
      </div>
    </form>
  );
}

function DisputeDetail({
  trade,
  dispute,
  onChanged,
  onError,
}: {
  trade: Trade;
  dispute: Dispute;
  onChanged: () => Promise<void>;
  onError: (refusal: Refusal | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const pill =
    dispute.status === "OPEN"
      ? { tone: "attention" as const, label: "Under review" }
      : dispute.status === "WITHDRAWN"
        ? { tone: "neutral" as const, label: "Withdrawn" }
        : { tone: "complete" as const, label: "Decided" };

  const attach = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    // A file that cannot be sent is refused, and said so, by pickImage itself.
    const image = await pickImage(file, "evidence");
    if (!image) {
      setBusy(false);
      return;
    }
    onError(null);
    const result = await marketClient.addEvidence(trade.id, image, note.trim());
    setBusy(false);
    if (!result.ok) {
      onError(result);
      return;
    }
    toast.success("Screenshot attached", {
      description: "The reviewer and the other side can see it now.",
    });
    setNote("");
    await onChanged();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={pill.tone}>{pill.label}</StatusPill>
        <span className="text-muted-foreground text-[13px]">
          Opened by {dispute.openedByMe ? "you" : trade.counterparty.username}{" "}
          {timeAgo(dispute.createdAt)}
        </span>
      </div>
      <div>
        <p className="text-foreground text-sm font-medium">{DISPUTE_REASONS[dispute.reason]}</p>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed whitespace-pre-line">
          {dispute.description}
        </p>
      </div>

      {dispute.status === "RESOLVED" && dispute.outcome ? (
        <div className="bg-status-complete text-status-complete-fg rounded-control px-4 py-3 text-[13px] leading-relaxed">
          <strong className="font-semibold">
            {dispute.outcome === "RELEASE_TO_BUYER"
              ? `Decided for the buyer: ${usdt(trade.buyerReceives)} was released.`
              : `Decided for the seller: ${usdt(trade.amount)} went back to them.`}
          </strong>
          {dispute.resolutionNote ? <p className="mt-1">{dispute.resolutionNote}</p> : null}
        </div>
      ) : null}

      <div>
        <p className="text-foreground mb-2 text-[13px] font-medium">
          Evidence {dispute.evidence.length > 0 ? `(${dispute.evidence.length})` : ""}
        </p>
        {dispute.evidence.length === 0 ? (
          <p className="text-muted-foreground text-[13px]">Nothing attached yet.</p>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {dispute.evidence.map((file) => (
              <li key={file.id} className="border-border overflow-hidden rounded-lg border">
                <a
                  href={marketClient.evidenceUrl(trade.id, file.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- bytes come from the API behind the session */}
                  <img
                    src={marketClient.evidenceUrl(trade.id, file.id)}
                    alt={file.note ?? "Evidence"}
                    className="aspect-square w-full object-cover"
                  />
                </a>
                <p className="text-muted-foreground truncate px-2 py-1 text-[11px]">
                  {file.uploadedBy === trade.role ? "You" : trade.counterparty.username}
                  {file.note ? ` · ${file.note}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {dispute.status === "OPEN" && dispute.evidenceLeft > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field
            label="Caption"
            hint={`You can attach ${dispute.evidenceLeft} more ${dispute.evidenceLeft === 1 ? "file" : "files"}.`}
            className="flex-1"
          >
            {(control) => (
              <Input
                {...control}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={200}
                placeholder="Telebirr receipt"
              />
            )}
          </Field>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => {
              void attach(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="md"
            loading={busy}
            onClick={() => fileRef.current?.click()}
            className="sm:mb-[1.85rem]"
          >
            Attach a screenshot
          </Button>
        </div>
      ) : null}

      {trade.actions.canWithdrawDispute ? (
        <div>
          <ConfirmButton
            question="Withdraw the dispute? The trade goes back to waiting for the seller to release."
            confirmLabel="Withdraw it"
            variant="ghost"
            onConfirm={async () => {
              onError(null);
              const result = await marketClient.withdrawDispute(trade.id);
              if (!result.ok) {
                onError(result);
                return;
              }
              toast.success("Dispute withdrawn", {
                description: "The trade is back to waiting for the seller to release.",
              });
              await onChanged();
            }}
          >
            Withdraw the dispute
          </ConfirmButton>
        </div>
      ) : null}
    </div>
  );
}
