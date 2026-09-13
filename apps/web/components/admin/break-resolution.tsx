"use client";

import { Warning } from "@phosphor-icons/react";
import { useState } from "react";

import { Amount } from "@/components/admin/admin-bits";
import { ActionButton, NeedsRole, useAdmin } from "@/components/admin/admin-shell";
import { Field, Textarea } from "@/components/ui/field";
import { Radio } from "@/components/ui/radio";
import { reconciliationClient, type ReconciliationBreak } from "@/lib/admin/operations";

/*
  The only path from a break to a ledger entry, and the reason it is a screen
  rather than a job.

  Two answers move money and one does not. Which two are offered depends on
  which way the break goes: a surplus can only be recorded as something we may
  owe, a shortfall can only be written off against the platform's own equity.
  You cannot book a shortfall as a windfall here, and the API refuses it too.

  Writing off is the one that costs the platform real money, so it says so in
  those words, with the figure in them, before the button.
*/

const MINIMUM = 10;

type Action = "RECORD_SURPLUS" | "WRITE_OFF_SHORTFALL" | "DISMISS";

export function BreakResolution({
  item,
  onResolved,
}: {
  item: ReconciliationBreak;
  onResolved: (item: ReconciliationBreak) => void;
}) {
  const admin = useAdmin();
  const may = admin.roles.includes("FINANCIAL_ADJUSTER");
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!may) {
    return (
      <NeedsRole role="FINANCIAL_ADJUSTER">
        <p className="text-muted-foreground mx-auto mt-3 max-w-sm text-[12px] leading-relaxed">
          Reading a break and resolving one are different capabilities on purpose. Resolving posts
          an entry that moves the platform&rsquo;s own money.
        </p>
      </NeedsRole>
    );
  }

  const surplus = item.kind === "SURPLUS";

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-foreground text-[15px] font-semibold">What to do about it</h2>
      {error ? (
        <p role="alert" className="text-destructive text-[13px]">
          {error}
        </p>
      ) : null}

      <div role="radiogroup" aria-label="Resolution" className="flex flex-col gap-2.5">
        {surplus ? (
          <Radio
            name="resolution"
            value="RECORD_SURPLUS"
            checked={action === "RECORD_SURPLUS"}
            onChange={() => setAction("RECORD_SURPLUS")}
            label="Book it as money we may owe"
            description="The coins are recognised as an asset and as an unidentified-deposits liability. Not revenue: somebody may come asking for them."
          />
        ) : (
          <Radio
            name="resolution"
            value="WRITE_OFF_SHORTFALL"
            checked={action === "WRITE_OFF_SHORTFALL"}
            onChange={() => setAction("WRITE_OFF_SHORTFALL")}
            label="Write it off as a loss"
            description="The platform's own equity absorbs it. No customer balance is reduced."
          />
        )}
        <Radio
          name="resolution"
          value="DISMISS"
          checked={action === "DISMISS"}
          onChange={() => setAction("DISMISS")}
          label="It was explained"
          description="Nothing is posted. For a break that turned out to have an innocent cause."
        />
      </div>

      {action === "WRITE_OFF_SHORTFALL" ? (
        <div className="rounded-surface border-destructive/30 bg-destructive/5 border px-4 py-3.5">
          <p className="text-foreground text-[13px] font-medium">
            This writes off <Amount value={item.difference} className="text-[13px]" /> USDT.
          </p>
          <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">
            It is a real loss taken by the platform, and it cannot be undone from here. Be sure the
            coins are gone rather than somewhere you have not looked yet - a sweep still confirming,
            or an address not in the set being compared.
          </p>
        </div>
      ) : null}

      <Field
        label="Why"
        hint="What you investigated and what you concluded. At least a sentence; kept permanently."
      >
        {(a11y) => (
          <Textarea
            {...a11y}
            rows={4}
            value={reason}
            placeholder="Traced every transfer to this address between…; the difference is accounted for by…"
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </Field>

      <ActionButton
        label="Resolve"
        busyLabel="Posting…"
        variant={action === "WRITE_OFF_SHORTFALL" ? "destructive" : "primary"}
        className="w-full"
        disabled={!action || reason.trim().length < MINIMUM}
        onRun={async () => {
          if (!action) return;
          setError(null);
          const result = await reconciliationClient.resolve(item.id, {
            action,
            reason: reason.trim(),
          });
          if (result.ok) onResolved(result.break);
          else setError(result.message);
        }}
      />

      <p className="text-muted-foreground flex items-start gap-2 text-[12px] leading-relaxed">
        <Warning size={14} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
        Recorded against your account. The two that post an entry cannot be reversed from this
        screen.
      </p>
    </section>
  );
}
