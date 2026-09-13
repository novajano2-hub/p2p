"use client";

import { ArrowLeft } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import {
  Amount,
  Code,
  CopyValue,
  dateTime,
  DetailList,
  DetailRow,
  Notice,
  Panel,
  ReasonNote,
  RowLink,
  Tag,
} from "@/components/admin/admin-bits";
import { NeedsRole, useAdmin } from "@/components/admin/admin-shell";
import { BreakResolution } from "@/components/admin/break-resolution";
import { AppLink } from "@/components/ui/app-link";
import { reconciliationClient, type ReconciliationBreak } from "@/lib/admin/operations";
import { BREAK_TONE, BREAK_WORDS } from "@/lib/admin/operations-view";

/*
  One disagreement between the chain and the books, and what a person did
  about it.

  The arithmetic is shown as a subtraction rather than as a single number,
  because the difference alone is not checkable. Somebody deciding to write
  off a loss should be able to see both sides of it and redo the sum in their
  head before they do.
*/

export function ReconciliationBreakView({ breakId }: { breakId: string }) {
  const admin = useAdmin();
  const mayRead = admin.roles.includes("LEDGER_VIEWER");
  const [item, setItem] = useState<ReconciliationBreak | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mayRead) return;
    let live = true;
    void reconciliationClient.one(breakId).then((result) => {
      if (!live) return;
      if (result.ok) setItem(result.break);
      else setError(result.message);
    });
    return () => {
      live = false;
    };
  }, [breakId, mayRead]);

  if (!mayRead) return <NeedsRole role="LEDGER_VIEWER" />;

  return (
    <>
      <AppLink
        href="/admin/reconciliation"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium transition-colors duration-150"
      >
        <ArrowLeft size={15} weight="bold" aria-hidden="true" />
        Reconciliation
      </AppLink>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {!item && !error ? <Notice tone="loading">Loading&hellip;</Notice> : null}

      {item ? (
        <div className="grid gap-5 lg:grid-cols-5">
          <div className="flex flex-col gap-5 lg:col-span-3">
            <Panel>
              <div className="border-border border-b px-5 py-5 text-center">
                <Tag tone={BREAK_TONE[item.status]}>{BREAK_WORDS[item.kind]}</Tag>
                <p className="text-foreground mt-3 font-mono text-[28px] leading-none font-semibold tabular-nums">
                  {item.kind === "SURPLUS" ? "+" : "−"}
                  <Amount value={item.difference} className="text-[28px]" />
                  <span className="text-muted-foreground ml-2 text-[15px] font-medium">
                    {item.asset}
                  </span>
                </p>
                <p className="text-muted-foreground mx-auto mt-2.5 max-w-md text-[13px] leading-relaxed">
                  {item.kind === "SURPLUS"
                    ? "There are coins at this position that the books do not account for. They may be somebody's."
                    : "The books say there should be more here than there is. Something has been lost or taken."}
                </p>
              </div>

              <div className="grid grid-cols-3 divide-x divide-[var(--border)]">
                <Side label="The ledger says" value={item.ledgerBalance} />
                <Side label="The chain shows" value={item.chainBalance} />
                <Side label="Difference" value={item.difference} strong />
              </div>
            </Panel>

            <Panel title="The record">
              <DetailList>
                <DetailRow label="Account">
                  <Code>{item.accountCode}</Code>
                </DetailRow>
                <DetailRow label="Network">{item.network}</DetailRow>
                <DetailRow label="First raised">
                  {dateTime.format(new Date(item.detectedAt))}
                </DetailRow>
                <DetailRow label="Last seen">
                  {dateTime.format(new Date(item.lastSeenAt))}
                </DetailRow>
                <DetailRow label="Adjustment">
                  {item.adjustmentTransactionId ? (
                    <RowLink href={`/admin/ledger/transactions/${item.adjustmentTransactionId}`}>
                      view the posting
                    </RowLink>
                  ) : (
                    <span className="text-muted-foreground">nothing posted</span>
                  )}
                </DetailRow>
                <DetailRow label="Correlation" wrap>
                  <CopyValue value={item.correlationId} label="Correlation id" />
                </DetailRow>
              </DetailList>
            </Panel>
          </div>

          <div className="flex flex-col gap-5 lg:col-span-2">
            {item.resolvedAt ? (
              <section className="flex flex-col gap-2.5">
                <h2 className="text-foreground text-[15px] font-semibold">
                  {item.status === "DISMISSED" ? "Dismissed" : "Resolved"}
                </h2>
                <ReasonNote
                  by={item.resolvedBy ?? "an administrator"}
                  at={dateTime.format(new Date(item.resolvedAt))}
                >
                  {item.resolutionReason ?? "No reason was recorded."}
                </ReasonNote>
              </section>
            ) : (
              <BreakResolution item={item} onResolved={setItem} />
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

function Side({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="px-4 py-3.5 text-center">
      <p className="text-muted-foreground text-[12px]">{label}</p>
      <p
        className={
          strong
            ? "text-destructive mt-1 font-mono text-[15px] font-semibold tabular-nums"
            : "text-foreground mt-1 font-mono text-[15px] tabular-nums"
        }
      >
        <Amount value={value} className="text-[15px]" />
      </p>
    </div>
  );
}
