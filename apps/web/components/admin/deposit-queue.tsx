"use client";

import { CheckCircle } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Amount, dateTime, Notice, PageHeading, Tag } from "@/components/admin/admin-bits";
import { NeedsRole, useAdmin } from "@/components/admin/admin-shell";
import { AppLink } from "@/components/ui/app-link";
import { Tabs } from "@/components/ui/tabs";
import { depositsClient, type AdminDeposit } from "@/lib/admin/operations";
import { DEPOSIT_WORDS } from "@/lib/admin/operations-view";

/*
  The deposits that need a person, in two queues rather than one list.

  They are two different jobs. "Held for review" is a deposit we know the
  owner of, where risk wants a second opinion before crediting; the question
  is should this be credited. "Nobody to credit" is money sitting in an
  account of ours that we cannot match to anybody; the question is whose is
  this. Same table underneath, different work, so they are not mixed - a
  reviewer working one should not have to skip rows of the other.

  Neither queue is the normal case. A deposit that behaves credits itself and
  is never seen here, which is why an empty screen is the expected screen.
*/

type State =
  | { status: "loading" }
  | { status: "ready"; deposits: AdminDeposit[] }
  | { status: "error"; message: string };

export function DepositQueue() {
  const admin = useAdmin();
  const may = admin.roles.includes("DEPOSIT_REVIEWER");
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!may) return;
    let live = true;
    void depositsClient.queue().then((result) => {
      if (!live) return;
      setState(
        result.ok
          ? { status: "ready", deposits: result.deposits }
          : { status: "error", message: result.message },
      );
    });
    return () => {
      live = false;
    };
  }, [may]);

  const heading = (
    <PageHeading
      title="Deposits"
      description="The few that need a person. A deposit that behaves credits itself."
    />
  );

  if (!may) {
    return (
      <>
        {heading}
        <NeedsRole role="DEPOSIT_REVIEWER" />
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

  const held = state.deposits.filter((deposit) => deposit.status === "MANUAL_REVIEW");
  const orphans = state.deposits.filter((deposit) => deposit.status === "UNATTRIBUTED");

  return (
    <>
      {heading}
      <Tabs
        label="Deposit queues"
        items={[
          {
            id: "held",
            label: `Held for review${held.length ? ` (${held.length})` : ""}`,
            content: (
              <Queue
                deposits={held}
                empty="Nothing is being held. Every deposit that arrived has credited itself."
              />
            ),
          },
          {
            id: "orphans",
            label: `Nobody to credit${orphans.length ? ` (${orphans.length})` : ""}`,
            content: (
              <Queue deposits={orphans} empty="Every transfer that reached us has an owner." />
            ),
          },
        ]}
      />
    </>
  );
}

function Queue({ deposits, empty }: { deposits: AdminDeposit[]; empty: string }) {
  if (deposits.length === 0) {
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
      {deposits.map((deposit) => {
        const said = DEPOSIT_WORDS[deposit.status];
        return (
          <li key={deposit.id}>
            <AppLink
              href={`/admin/deposits/${deposit.id}`}
              className="group rounded-surface border-border bg-surface hover:border-primary/40 flex flex-col gap-2 border px-4 py-3.5 transition-[border-color] duration-150"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-foreground group-hover:text-primary text-[15px] font-semibold transition-colors duration-150">
                  <Amount value={deposit.amount} className="text-[15px]" />
                  <span className="text-muted-foreground ml-1.5 text-[12px] font-medium">USDT</span>
                </span>
                <Tag tone={said.tone}>{said.words}</Tag>
              </div>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <p className="text-muted-foreground min-w-0 truncate text-[13px]">
                  {deposit.customer ? (
                    <>
                      <span className="font-mono">{deposit.customer.platformId}</span> ·{" "}
                      {deposit.customer.username}
                    </>
                  ) : (
                    "no account matches this address"
                  )}
                </p>
                <p className="text-muted-foreground shrink-0 text-[12px] tabular-nums">
                  {dateTime.format(new Date(deposit.detectedAt))}
                </p>
              </div>
              {deposit.reviewReason ? (
                <p className="text-muted-foreground text-[12px] italic">{deposit.reviewReason}</p>
              ) : null}
            </AppLink>
          </li>
        );
      })}
    </ul>
  );
}
