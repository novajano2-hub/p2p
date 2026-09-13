"use client";

import { CheckCircle } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Amount, dateTime, Notice, PageHeading, Tag } from "@/components/admin/admin-bits";
import { NeedsRole, useAdmin } from "@/components/admin/admin-shell";
import { AppLink } from "@/components/ui/app-link";
import { Tabs } from "@/components/ui/tabs";
import { withdrawalsClient, type AdminWithdrawal } from "@/lib/admin/operations";
import { WITHDRAWAL_WORDS } from "@/lib/admin/operations-view";

/*
  The withdrawals that need a person, in the two kinds they come in.

  "Waiting for approval" is money held, nothing sent, and the question is may
  it go. "Needs investigating" is the uncomfortable one: something was handed
  to custody and we do not know whether it reached the chain. Nothing in that
  second queue is ever retried or refunded automatically, which is why it is a
  queue at all (ADR-0010).

  The customer's own withdrawal never appears here.
*/

type State =
  | { status: "loading" }
  | { status: "ready"; review: AdminWithdrawal[]; investigation: AdminWithdrawal[] }
  | { status: "error"; message: string };

export function WithdrawalQueue() {
  const admin = useAdmin();
  const may = admin.roles.includes("WITHDRAWAL_APPROVER");
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!may) return;
    let live = true;
    void withdrawalsClient.queue().then((result) => {
      if (!live) return;
      setState(
        result.ok
          ? { status: "ready", review: result.review, investigation: result.investigation }
          : { status: "error", message: result.message },
      );
    });
    return () => {
      live = false;
    };
  }, [may]);

  const heading = (
    <PageHeading
      title="Withdrawals"
      description="Money held pending a decision, and transfers whose outcome nobody can be sure of."
    />
  );

  if (!may) {
    return (
      <>
        {heading}
        <NeedsRole role="WITHDRAWAL_APPROVER" />
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
        label="Withdrawal queues"
        items={[
          {
            id: "review",
            label: `Waiting for approval${state.review.length ? ` (${state.review.length})` : ""}`,
            content: (
              <Queue
                withdrawals={state.review}
                empty="Nothing is held. Every request has either gone or been decided."
              />
            ),
          },
          {
            id: "investigation",
            label: `Needs investigating${
              state.investigation.length ? ` (${state.investigation.length})` : ""
            }`,
            content: (
              <Queue
                withdrawals={state.investigation}
                empty="Every transfer we handed to custody has a known outcome."
              />
            ),
          },
        ]}
      />
    </>
  );
}

function Queue({ withdrawals, empty }: { withdrawals: AdminWithdrawal[]; empty: string }) {
  if (withdrawals.length === 0) {
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
      {withdrawals.map((withdrawal) => {
        const said = WITHDRAWAL_WORDS[withdrawal.status];
        const signed = withdrawal.approvals.length;
        return (
          <li key={withdrawal.id}>
            <AppLink
              href={`/admin/withdrawals/${withdrawal.id}`}
              className="group rounded-surface border-border bg-surface hover:border-primary/40 flex flex-col gap-2 border px-4 py-3.5 transition-[border-color] duration-150"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-foreground group-hover:text-primary text-[15px] font-semibold transition-colors duration-150">
                  <Amount value={withdrawal.amount} className="text-[15px]" />
                  <span className="text-muted-foreground ml-1.5 text-[12px] font-medium">USDT</span>
                </span>
                <Tag tone={said.tone}>{said.words}</Tag>
              </div>

              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <p className="text-muted-foreground min-w-0 truncate text-[13px]">
                  {withdrawal.customer ? (
                    <>
                      <span className="font-mono">{withdrawal.customer.platformId}</span> ·{" "}
                      {withdrawal.customer.username}
                    </>
                  ) : (
                    "account no longer exists"
                  )}
                </p>
                <p className="text-muted-foreground shrink-0 text-[12px] tabular-nums">
                  {dateTime.format(new Date(withdrawal.requestedAt))}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {withdrawal.approvalsRequired > 0 ? (
                  <span
                    className={
                      signed >= withdrawal.approvalsRequired
                        ? "text-status-complete-fg text-[12px] font-medium"
                        : "text-muted-foreground text-[12px]"
                    }
                  >
                    {signed} of {withdrawal.approvalsRequired} approved
                  </span>
                ) : null}
                {withdrawal.riskScore === null ? null : (
                  <span className="text-muted-foreground text-[12px] tabular-nums">
                    risk {withdrawal.riskScore}
                  </span>
                )}
                {withdrawal.riskReasons.slice(0, 2).map((reason) => (
                  <span key={reason} className="text-muted-foreground text-[12px] italic">
                    {reason}
                  </span>
                ))}
              </div>
            </AppLink>
          </li>
        );
      })}
    </ul>
  );
}
