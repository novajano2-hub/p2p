"use client";

import { ArrowLeft, Info } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import {
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
import { DepositDecision } from "@/components/admin/deposit-decision";
import { AppLink } from "@/components/ui/app-link";
import { depositsClient, type AdminDeposit } from "@/lib/admin/operations";
import { depositRail, DEPOSIT_WORDS } from "@/lib/admin/operations-view";

/*
  One deposit, whole.

  Laid out the way an exchange shows a customer their own transfer - the
  amount first, then where it got to, then the facts with the hashes
  copyable - because that is the fastest way to answer "what happened to this
  money", and the administrator is asking the same question with more at
  stake. What is added: who it is about, why it stopped, the ledger entry it
  posted, and the decision itself.

  Nothing here is truncated with an ellipsis. A reviewer checking an address
  against an explorer needs every character of it.
*/

export function DepositReview({ depositId }: { depositId: string }) {
  const admin = useAdmin();
  const may = admin.roles.includes("DEPOSIT_REVIEWER");
  const [deposit, setDeposit] = useState<AdminDeposit | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!may) return;
    let live = true;
    void depositsClient.one(depositId).then((result) => {
      if (!live) return;
      if (result.ok) setDeposit(result.deposit);
      else setError(result.message);
    });
    return () => {
      live = false;
    };
  }, [depositId, may]);

  if (!may) return <NeedsRole role="DEPOSIT_REVIEWER" />;

  return (
    <>
      <AppLink
        href="/admin/deposits"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium transition-colors duration-150"
      >
        <ArrowLeft size={15} weight="bold" aria-hidden="true" />
        Deposits
      </AppLink>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {!deposit && !error ? <Notice tone="loading">Loading the deposit&hellip;</Notice> : null}

      {deposit ? (
        <div className="grid gap-5 lg:grid-cols-5">
          <div className="flex flex-col gap-5 lg:col-span-3">
            <Panel>
              <AmountHeader
                sign="+"
                amount={deposit.amount}
                asset="USDT"
                tone={DEPOSIT_WORDS[deposit.status].tone}
                status={DEPOSIT_WORDS[deposit.status].words}
                {...(DEPOSIT_WORDS[deposit.status].note
                  ? { note: DEPOSIT_WORDS[deposit.status].note }
                  : {})}
              />
              <StepRail steps={depositRail(deposit)} />
            </Panel>

            <Panel title="On the chain">
              <DetailList>
                <DetailRow label="Network">{deposit.network} · BEP-20</DetailRow>
                <DetailRow label="Transaction" wrap>
                  <CopyValue value={deposit.txHash} label="Transaction hash" />
                </DetailRow>
                <DetailRow label="Log index">{deposit.logIndex}</DetailRow>
                <DetailRow label="Block">
                  <span className="font-mono tabular-nums">{deposit.blockNumber}</span>
                </DetailRow>
                <DetailRow label="Confirmations">
                  <span className="font-mono tabular-nums">
                    {deposit.confirmations} / {deposit.confirmationsRequired}
                  </span>
                </DetailRow>
                <DetailRow label="Sent from" wrap>
                  <CopyValue value={deposit.fromAddress} label="Sending address" />
                </DetailRow>
                <DetailRow label="Sent to" wrap>
                  <CopyValue value={deposit.toAddress} label="Receiving address" />
                </DetailRow>
                <DetailRow label="Token" wrap>
                  <CopyValue value={deposit.tokenContract} label="Token contract" />
                </DetailRow>
                <DetailRow label="Raw amount">
                  <span className="font-mono text-[12px] tabular-nums">{deposit.rawAmount}</span>
                </DetailRow>
                <DetailRow label="Found by">{deposit.detectedVia}</DetailRow>
                <DetailRow label="First seen">
                  {dateTime.format(new Date(deposit.detectedAt))}
                </DetailRow>
              </DetailList>
            </Panel>
          </div>

          <div className="flex flex-col gap-5 lg:col-span-2">
            <Panel title="On our side">
              <DetailList>
                <DetailRow label="Customer" wrap>
                  <CustomerLine customer={deposit.customer} />
                </DetailRow>
                {deposit.customer ? (
                  <DetailRow label="Account">
                    {deposit.customer.status.toLowerCase()} ·{" "}
                    {deposit.customer.kycStatus.replace(/_/g, " ").toLowerCase()}
                  </DetailRow>
                ) : null}
                <DetailRow label="Ledger entry">
                  {deposit.ledgerTransactionId ? (
                    <RowLink href={`/admin/ledger/transactions/${deposit.ledgerTransactionId}`}>
                      view the posting
                    </RowLink>
                  ) : (
                    <span className="text-muted-foreground">nothing posted</span>
                  )}
                </DetailRow>
                <DetailRow label="Credited">
                  {deposit.creditedAt ? dateTime.format(new Date(deposit.creditedAt)) : "—"}
                </DetailRow>
                <DetailRow label="Correlation" wrap>
                  <CopyValue value={deposit.correlationId} label="Correlation id" />
                </DetailRow>
              </DetailList>
            </Panel>

            {deposit.reviewReason ? (
              <div className="rounded-surface border-status-pending-fg/25 bg-status-pending/30 flex items-start gap-2.5 border px-4 py-3">
                <Info
                  size={17}
                  weight="fill"
                  aria-hidden="true"
                  className="text-status-pending-fg mt-0.5 shrink-0"
                />
                <div>
                  <p className="text-foreground text-[13px] font-medium">Why it stopped</p>
                  <p className="text-muted-foreground mt-0.5 text-[13px] leading-relaxed">
                    {deposit.reviewReason}
                  </p>
                </div>
              </div>
            ) : null}

            {deposit.decidedAt ? (
              <ReasonNote
                by={deposit.decidedBy ?? "an administrator"}
                at={dateTime.format(new Date(deposit.decidedAt))}
              >
                {deposit.decisionReason ?? "Decided without a note."}
              </ReasonNote>
            ) : null}

            <DepositDecision deposit={deposit} onDecided={setDeposit} />
          </div>
        </div>
      ) : null}
    </>
  );
}
