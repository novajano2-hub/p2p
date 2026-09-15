"use client";

import { CheckCircle, Paperclip } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Amount, Birr, dateTime, Notice, PageHeading, Tag } from "@/components/admin/admin-bits";
import { NeedsRole, useAdmin } from "@/components/admin/admin-shell";
import { AppLink } from "@/components/ui/app-link";
import { Tabs } from "@/components/ui/tabs";
import { disputesClient, type AdminDispute } from "@/lib/admin/disputes";
import { OUTCOME_WORDS, REASON_WORDS } from "@/lib/admin/disputes-view";

/*
  The trades two people could not finish between them.

  Every row here is escrow that is going nowhere until somebody decides: the
  USDT is locked, the buyer says one thing and the seller another, and the
  only two ways out both pay somebody. Oldest first, because the party who
  has been waiting longest has been waiting without their money.

  The decided ones are kept beside them, few and newest first, so that a
  resolver can see how the last ones went before making another like them.
*/

type State =
  | { status: "loading" }
  | { status: "ready"; open: AdminDispute[]; recent: AdminDispute[] }
  | { status: "error"; message: string };

export function DisputeQueue() {
  const admin = useAdmin();
  const may = admin.roles.includes("DISPUTE_RESOLVER");
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!may) return;
    let live = true;
    void disputesClient.queue().then((result) => {
      if (!live) return;
      setState(
        result.ok
          ? { status: "ready", open: result.open, recent: result.recent }
          : { status: "error", message: result.message },
      );
    });
    return () => {
      live = false;
    };
  }, [may]);

  const heading = (
    <PageHeading
      title="Disputes"
      description="Trades whose escrow is held until a person decides where it goes."
    />
  );

  if (!may) {
    return (
      <>
        {heading}
        <NeedsRole role="DISPUTE_RESOLVER" />
      </>
    );
  }
  if (state.status !== "ready") {
    return (
      <>
        {heading}
        {state.status === "loading" ? (
          <Notice tone="loading">Loading the queue&hellip;</Notice>
        ) : (
          <Notice tone="error">{state.message}</Notice>
        )}
      </>
    );
  }

  return (
    <>
      {heading}
      <Tabs
        label="Disputes"
        items={[
          {
            id: "open",
            label: `Waiting for a decision${state.open.length ? ` (${state.open.length})` : ""}`,
            content: (
              <Queue
                disputes={state.open}
                empty="No escrow is held for a decision. Every trade is between its two people."
              />
            ),
          },
          {
            id: "recent",
            label: "Recently decided",
            content: (
              <Queue disputes={state.recent} empty="Nothing has been decided or withdrawn yet." />
            ),
          },
        ]}
      />
    </>
  );
}

function Queue({ disputes, empty }: { disputes: AdminDispute[]; empty: string }) {
  if (disputes.length === 0) {
    return (
      <div className="rounded-surface border-border bg-surface border px-5 py-12 text-center">
        <span className="bg-status-complete text-status-complete-fg mx-auto mb-3 flex size-11 items-center justify-center rounded-full">
          <CheckCircle size={22} weight="duotone" aria-hidden="true" />
        </span>
        <p className="text-foreground text-sm font-medium">Nothing waiting</p>
        <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-[13px]">{empty}</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {disputes.map((dispute) => (
        <li key={dispute.id}>
          <AppLink
            href={`/admin/disputes/${dispute.id}`}
            className="group rounded-surface border-border bg-surface hover:border-primary/40 flex flex-col gap-2 border px-4 py-3.5 transition-[border-color] duration-150"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-foreground group-hover:text-primary text-[15px] font-semibold transition-colors duration-150">
                <Amount value={dispute.trade.amount} className="text-[15px]" />
                <span className="text-muted-foreground ml-1.5 text-[12px] font-medium">USDT</span>
                <span className="text-muted-foreground mx-1.5 text-[12px]">for</span>
                <Birr value={dispute.trade.fiatSantim} className="text-[13px] font-medium" />
                <span className="text-muted-foreground ml-1 text-[12px] font-medium">birr</span>
              </span>
              <Verdict dispute={dispute} />
            </div>

            <p className="text-foreground text-[13px]">
              {REASON_WORDS[dispute.reason]}
              <span className="text-muted-foreground">
                {" "}
                · opened by the {dispute.openedBy.toLowerCase()}
              </span>
            </p>

            <p className="text-muted-foreground line-clamp-2 text-[13px] leading-relaxed">
              {dispute.description}
            </p>

            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <p className="text-muted-foreground min-w-0 truncate text-[12px]">
                <Party party={dispute.seller} role="seller" /> <span aria-hidden="true">→</span>{" "}
                <Party party={dispute.buyer} role="buyer" />
              </p>
              <p className="text-muted-foreground flex shrink-0 items-center gap-2.5 text-[12px] tabular-nums">
                {dispute.evidenceCount > 0 ? (
                  <span className="flex items-center gap-1">
                    <Paperclip size={12} weight="bold" aria-hidden="true" />
                    {dispute.evidenceCount}
                  </span>
                ) : null}
                {dateTime.format(new Date(dispute.createdAt))}
              </p>
            </div>
          </AppLink>
        </li>
      ))}
    </ul>
  );
}

/** Where the dispute got to, if anywhere: the tag is the thing that differs down the column. */
function Verdict({ dispute }: { dispute: AdminDispute }) {
  if (dispute.status === "OPEN") return <Tag tone="attention">Undecided</Tag>;
  if (dispute.status === "WITHDRAWN") return <Tag tone="neutral">Withdrawn</Tag>;
  return (
    <Tag tone="complete">{dispute.outcome ? OUTCOME_WORDS[dispute.outcome].short : "Decided"}</Tag>
  );
}

function Party({
  party,
  role,
}: {
  party: { customer: { platformId: string; username: string } | null };
  role: string;
}) {
  if (!party.customer) return <span className="italic">{role} account gone</span>;
  return (
    <>
      <span className="font-mono">{party.customer.platformId}</span> {party.customer.username}
    </>
  );
}
