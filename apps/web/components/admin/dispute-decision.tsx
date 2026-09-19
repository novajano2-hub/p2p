"use client";

import { Scales, Warning } from "@phosphor-icons/react";
import { useState } from "react";

import { Amount } from "@/components/admin/admin-bits";
import { ActionButton } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Radio, RadioGroup } from "@/components/ui/radio";
import {
  disputesClient,
  type AdminDispute,
  type AdminDisputeDetail,
  type DisputeOutcome,
} from "@/lib/admin/disputes";
import { DISPUTE_OUTCOMES } from "@/lib/admin/disputes";
import { OUTCOME_WORDS } from "@/lib/admin/disputes-view";
import { toast, toastFailure } from "@/lib/toast";

/*
  Deciding. Two outcomes, opposite consequences, no undo.

  The escrow is real money and it is going to exactly one of these two people
  the moment this is pressed, so the screen makes the resolver say which and
  why before the button will work, then states the consequence in names and
  digits and asks once more. The note is not paperwork: both parties are sent
  it word for word, and it is the only explanation either of them gets.

  Nothing here decides anything itself. It posts the outcome to the API, which
  settles the escrow through the same path a normal release or cancellation
  takes - the ledger cannot tell the difference, which is the point.
*/

const NOTE_MINIMUM = 10;
const NOTE_MAXIMUM = 1_000;

export function DisputeDecision({
  dispute,
  onDecided,
}: {
  dispute: AdminDisputeDetail;
  onDecided: (dispute: AdminDispute) => void;
}) {
  const [outcome, setOutcome] = useState<DisputeOutcome | null>(null);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (dispute.status !== "OPEN") return null;

  const trimmed = note.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < NOTE_MINIMUM;
  const ready = outcome !== null && trimmed.length >= NOTE_MINIMUM;
  const paid = outcome === "RELEASE_TO_BUYER" ? dispute.buyer : dispute.seller;
  const paidName = paid.customer ? paid.customer.username : "an account that no longer exists";

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-foreground flex items-center gap-2 text-[15px] font-semibold">
        <Scales size={17} weight="fill" aria-hidden="true" className="text-muted-foreground" />
        Decide
      </h2>

      {error ? (
        <p role="alert" className="text-destructive text-[13px]">
          {error}
        </p>
      ) : null}

      <RadioGroup legend="Where the escrow goes" hint="One of the two. There is no third answer.">
        {DISPUTE_OUTCOMES.map((value) => (
          <Radio
            key={value}
            name="outcome"
            value={value}
            checked={outcome === value}
            onChange={() => {
              setOutcome(value);
              setConfirming(false);
            }}
            label={OUTCOME_WORDS[value].words}
            description={OUTCOME_WORDS[value].consequence}
          />
        ))}
      </RadioGroup>

      <Field
        label="What you decided and why"
        hint="Sent to both parties exactly as you write it, and kept against your account permanently."
        error={tooShort ? "Say why, in at least a few words." : undefined}
      >
        {(a11y) => (
          <Textarea
            {...a11y}
            value={note}
            maxLength={NOTE_MAXIMUM}
            placeholder="What the evidence shows, which account the ETB came from, and why that decides it."
            onChange={(event) => {
              setNote(event.target.value);
              setConfirming(false);
            }}
          />
        )}
      </Field>

      {confirming && outcome ? (
        <div className="rounded-surface border-destructive/30 bg-destructive/5 flex flex-col gap-3 border px-4 py-4">
          <div>
            <p className="text-foreground text-[14px] font-medium">
              {outcome === "RELEASE_TO_BUYER" ? "Pay the buyer" : "Return it to the seller"}
            </p>
            <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">
              <Amount value={dispute.trade.amount} /> USDT goes to {paidName}. The other party gets
              nothing and is told why in your words. This cannot be reversed here or anywhere else.
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <ActionButton
              label="Yes, decide it"
              busyLabel="Deciding…"
              variant="destructive"
              onRun={async () => {
                setError(null);
                const result = await disputesClient.resolve(dispute.id, {
                  outcome,
                  note: trimmed,
                });
                if (result.ok) {
                  toast.success("Dispute decided", {
                    description: `The escrow went to ${paidName}. Both sides are told, with your note.`,
                  });
                  onDecided(result.dispute);
                } else {
                  setConfirming(false);
                  setError(result.message);
                  toastFailure(result);
                }
              }}
            />
            <Button type="button" variant="ghost" size="lg" onClick={() => setConfirming(false)}>
              Not yet
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          size="lg"
          className="w-full"
          disabled={!ready}
          onClick={() => setConfirming(true)}
        >
          Decide
        </Button>
      )}

      <p className="text-muted-foreground flex items-start gap-2 text-[12px] leading-relaxed">
        <Warning size={14} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
        Recorded against your account with what you typed, and posted to the ledger where it moves
        money. Reading this page is recorded too.
      </p>
    </section>
  );
}
