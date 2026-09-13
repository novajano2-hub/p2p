"use client";

import { ArrowLeft, ShieldWarning } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import {
  Amount,
  AmountHeader,
  CopyValue,
  CustomerLine,
  dateTime,
  DetailList,
  DetailRow,
  Notice,
  Panel,
  ReasonNote,
  RowLink,
  StepRail,
} from "@/components/admin/admin-bits";
import { NeedsRole, useAdmin } from "@/components/admin/admin-shell";
import { WithdrawalDecision } from "@/components/admin/withdrawal-decision";
import { AppLink } from "@/components/ui/app-link";
import { withdrawalsClient, type AdminWithdrawal } from "@/lib/admin/operations";
import { withdrawalRail, WITHDRAWAL_WORDS } from "@/lib/admin/operations-view";

/*
  One withdrawal, and the case for letting it go.

  Money out is the irreversible direction, so this screen shows more than the
  deposit one does: what risk thought and why, who has already approved it and
  what they said, and every ledger entry the transfer has posted so far. An
  approver should be able to answer "why is this in front of me" without
  leaving the page.
*/

export function WithdrawalReview({ withdrawalId }: { withdrawalId: string }) {
  const admin = useAdmin();
  const may = admin.roles.includes("WITHDRAWAL_APPROVER");
  const [withdrawal, setWithdrawal] = useState<AdminWithdrawal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!may) return;
    let live = true;
    void withdrawalsClient.one(withdrawalId).then((result) => {
      if (!live) return;
      if (result.ok) setWithdrawal(result.withdrawal);
      else setError(result.message);
    });
    return () => {
      live = false;
    };
  }, [withdrawalId, may]);

  if (!may) return <NeedsRole role="WITHDRAWAL_APPROVER" />;

  const said = withdrawal ? WITHDRAWAL_WORDS[withdrawal.status] : null;

  return (
    <>
      <AppLink
        href="/admin/withdrawals"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium transition-colors duration-150"
      >
        <ArrowLeft size={15} weight="bold" aria-hidden="true" />
        Withdrawals
      </AppLink>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {!withdrawal && !error ? <Notice tone="loading">Loading&hellip;</Notice> : null}

      {withdrawal && said ? (
        <div className="grid gap-5 lg:grid-cols-5">
          <div className="flex flex-col gap-5 lg:col-span-3">
            <Panel>
              <AmountHeader
                sign="−"
                amount={withdrawal.amount}
                asset="USDT"
                tone={said.tone}
                status={said.words}
                {...(said.note ? { note: said.note } : {})}
              />
              <StepRail steps={withdrawalRail(withdrawal)} />
            </Panel>

            <Panel title="The transfer">
              <DetailList>
                <DetailRow label="Network">{withdrawal.network} · BEP-20</DetailRow>
                <DetailRow label="Destination" wrap>
                  <CopyValue value={withdrawal.destination} label="Destination address" />
                </DetailRow>
                <DetailRow label="Amount">
                  <Amount value={withdrawal.amount} /> {withdrawal.asset}
                </DetailRow>
                <DetailRow label="Fee">
                  <Amount value={withdrawal.fee} /> {withdrawal.asset}
                </DetailRow>
                <DetailRow label="Transaction" wrap>
                  {withdrawal.txHash ? (
                    <CopyValue value={withdrawal.txHash} label="Transaction hash" />
                  ) : (
                    <span className="text-muted-foreground">nothing on the chain yet</span>
                  )}
                </DetailRow>
                <DetailRow label="Confirmations">
                  <span className="font-mono tabular-nums">
                    {withdrawal.confirmations} / {withdrawal.confirmationsRequired}
                  </span>
                </DetailRow>
                <DetailRow label="Custody reference" wrap>
                  {withdrawal.providerRef ? (
                    <CopyValue value={withdrawal.providerRef} label="Custody reference" />
                  ) : (
                    <span className="text-muted-foreground">never handed over</span>
                  )}
                </DetailRow>
                <DetailRow label="Build attempts">{withdrawal.buildAttempts}</DetailRow>
                <DetailRow label="Requested">
                  {dateTime.format(new Date(withdrawal.requestedAt))}
                </DetailRow>
                <DetailRow label="Broadcast">
                  {withdrawal.broadcastAt ? dateTime.format(new Date(withdrawal.broadcastAt)) : "—"}
                </DetailRow>
                <DetailRow label="Settled">
                  {withdrawal.settledAt ? dateTime.format(new Date(withdrawal.settledAt)) : "—"}
                </DetailRow>
              </DetailList>
            </Panel>
          </div>

          <div className="flex flex-col gap-5 lg:col-span-2">
            <Panel title="Who and why">
              <DetailList>
                <DetailRow label="Customer" wrap>
                  <CustomerLine customer={withdrawal.customer} />
                </DetailRow>
                {withdrawal.customer ? (
                  <DetailRow label="Account">
                    {withdrawal.customer.status.toLowerCase()} ·{" "}
                    {withdrawal.customer.kycStatus.replace(/_/g, " ").toLowerCase()}
                  </DetailRow>
                ) : null}
                <DetailRow label="Risk score">
                  {withdrawal.riskScore === null ? (
                    <span className="text-muted-foreground">not scored</span>
                  ) : (
                    <span className="font-mono tabular-nums">{withdrawal.riskScore}</span>
                  )}
                </DetailRow>
                <DetailRow label="Approvals">
                  {withdrawal.approvals.length} of {withdrawal.approvalsRequired}
                </DetailRow>
                <DetailRow label="Correlation" wrap>
                  <CopyValue value={withdrawal.correlationId} label="Correlation id" />
                </DetailRow>
              </DetailList>
            </Panel>

            {withdrawal.riskReasons.length > 0 ? (
              <div className="rounded-surface border-status-pending-fg/25 bg-status-pending/30 border px-4 py-3.5">
                <div className="flex items-start gap-2.5">
                  <ShieldWarning
                    size={17}
                    weight="fill"
                    aria-hidden="true"
                    className="text-status-pending-fg mt-0.5 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-foreground text-[13px] font-medium">Why risk held it</p>
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {withdrawal.riskReasons.map((reason) => (
                        <li
                          key={reason}
                          className="text-muted-foreground text-[13px] leading-relaxed"
                        >
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ) : null}

            {withdrawal.failureReason ? (
              <div className="rounded-surface border-status-attention-fg/25 bg-status-attention/25 border px-4 py-3.5">
                <p className="text-foreground text-[13px] font-medium">What went wrong</p>
                <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">
                  {withdrawal.failureReason}
                </p>
              </div>
            ) : null}

            {withdrawal.approvals.length > 0 ? (
              <section className="flex flex-col gap-2.5">
                <h2 className="text-foreground text-[15px] font-semibold">Already approved by</h2>
                {withdrawal.approvals.map((approval) => (
                  <ReasonNote
                    key={`${approval.adminId}-${approval.createdAt}`}
                    by={approval.adminEmail}
                    at={dateTime.format(new Date(approval.createdAt))}
                  >
                    {approval.reason ?? "Approved without a note."}
                  </ReasonNote>
                ))}
              </section>
            ) : null}

            <Panel title="What it posted">
              <DetailList>
                <DetailRow label="Hold">
                  <Posting id={withdrawal.holdTransactionId} />
                </DetailRow>
                <DetailRow label="Broadcast">
                  <Posting id={withdrawal.broadcastTransactionId} />
                </DetailRow>
                <DetailRow label="Settlement">
                  <Posting id={withdrawal.settledTransactionId} />
                </DetailRow>
              </DetailList>
            </Panel>

            {withdrawal.message ? (
              <div className="border-border bg-muted/40 rounded-surface border px-4 py-3">
                <p className="text-muted-foreground text-[12px]">What the customer is told</p>
                <p className="text-foreground mt-1 text-[13px] leading-relaxed">
                  {withdrawal.message}
                </p>
              </div>
            ) : null}

            <WithdrawalDecision withdrawal={withdrawal} onDecided={setWithdrawal} />
          </div>
        </div>
      ) : null}
    </>
  );
}

/** A link to the double entry a step posted, or a word saying it never ran. */
function Posting({ id }: { id: string | null }) {
  if (!id) return <span className="text-muted-foreground">—</span>;
  return <RowLink href={`/admin/ledger/transactions/${id}`}>view the posting</RowLink>;
}
