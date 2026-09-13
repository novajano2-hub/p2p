"use client";

import { ArrowLeft } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";

import { NeedsRole, useAdmin } from "@/components/admin/admin-shell";
import {
  Amount,
  Code,
  dateTime,
  humanize,
  Notice,
  PageHeading,
  Panel,
  ReasonTag,
  RowLink,
  Table,
  TD,
  TD_NUM,
  TH,
} from "@/components/admin/admin-bits";
import { AppLink } from "@/components/ui/app-link";
import { ledgerClient, type LedgerTransactionDetail } from "@/lib/admin/ledger";

/*
  One transaction, the way a journal shows it: the debit lines, the credit
  lines, and the proof at the bottom that the two columns are equal. Around
  it, everything the ledger recorded about why - reason, reference, actor,
  the request it came from - and its place in history: what it reversed,
  and what has since reversed it. Nothing here is edited, because nothing
  in the ledger ever is (ADR-0003): a mistake is answered by another
  transaction, which appears below as "reversed by".
*/

type State =
  | { status: "loading" }
  | { status: "ready"; transaction: LedgerTransactionDetail }
  | { status: "error"; message: string };

export function LedgerTransactionView({ transactionId }: { transactionId: string }) {
  const admin = useAdmin();
  const may = admin.roles.includes("LEDGER_VIEWER");
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!may) return;
    let live = true;
    void ledgerClient.transaction(transactionId).then((result) => {
      if (!live) return;
      setState(
        result.ok
          ? { status: "ready", transaction: result.transaction }
          : { status: "error", message: result.message },
      );
    });
    return () => {
      live = false;
    };
  }, [may, transactionId]);

  const back = (
    <AppLink
      href="/admin/ledger/transactions"
      className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium transition-colors duration-150"
    >
      <ArrowLeft size={15} weight="bold" aria-hidden="true" />
      Transactions
    </AppLink>
  );

  if (!may) {
    return (
      <>
        {back}
        <NeedsRole role="LEDGER_VIEWER" />
      </>
    );
  }
  if (state.status !== "ready") {
    return (
      <>
        {back}
        {state.status === "loading" ? (
          <Notice tone="loading">Loading the transaction&hellip;</Notice>
        ) : (
          <Notice tone="error">{state.message}</Notice>
        )}
      </>
    );
  }

  const t = state.transaction;
  const debits = t.entries.filter((entry) => entry.direction === "DEBIT");
  const credits = t.entries.filter((entry) => entry.direction === "CREDIT");
  const total = (lines: typeof t.entries) =>
    lines.reduce((sum, entry) => sum + BigInt(entry.amount), 0n).toString();

  return (
    <>
      {back}
      <PageHeading
        title={humanize(t.reason).replace(/^./, (c) => c.toUpperCase())}
        description={`Posted ${dateTime.format(new Date(t.createdAt))}.`}
        actions={<ReasonTag reason={t.reason} />}
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel title="Entries" className="lg:col-span-3">
          <Table>
            <thead>
              <tr>
                <th className={TH}>Account</th>
                <th className={`${TH} text-right`}>Debit</th>
                <th className={`${TH} text-right`}>Credit</th>
              </tr>
            </thead>
            <tbody>
              {[...debits, ...credits].map((entry) => (
                <tr key={entry.id} className="border-border border-t">
                  <td className={`${TD} ${entry.direction === "CREDIT" ? "pl-8" : ""}`}>
                    <AppLink
                      href={`/admin/ledger/accounts/${entry.accountId}`}
                      className="hover:text-primary transition-colors duration-150"
                    >
                      <Code className="text-foreground">{entry.accountCode}</Code>
                    </AppLink>
                  </td>
                  <td className={TD_NUM}>
                    {entry.direction === "DEBIT" ? <Amount value={entry.amount} /> : null}
                  </td>
                  <td className={TD_NUM}>
                    {entry.direction === "CREDIT" ? <Amount value={entry.amount} /> : null}
                  </td>
                </tr>
              ))}
              <tr className="border-border bg-muted/40 border-t">
                <td className={`${TD} font-medium`}>Totals</td>
                <td className={TD_NUM}>
                  <Amount value={total(debits)} />
                </td>
                <td className={TD_NUM}>
                  <Amount value={total(credits)} />
                </td>
              </tr>
            </tbody>
          </Table>
        </Panel>

        <Panel title="Record" className="lg:col-span-2">
          <dl className="divide-border divide-y px-4">
            <Row label="Transaction">
              <Code>{t.id}</Code>
            </Row>
            <Row label="Reference">
              <span className="text-muted-foreground">{t.referenceType} </span>
              <Code>{t.referenceId}</Code>
            </Row>
            <Row label="Actor">
              <span className="capitalize">{t.actorType.toLowerCase()}</span>
              {t.actorId ? (
                <>
                  {" "}
                  <Code>{t.actorId}</Code>
                </>
              ) : null}
            </Row>
            <Row label="Asset">{t.asset}</Row>
            <Row label="Correlation id">
              <Code>{t.correlationId}</Code>
            </Row>
            <Row label="Idempotency key">
              <Code>{t.idempotencyKey}</Code>
            </Row>
            <Row label="Reverses">
              {t.reverses ? (
                <RowLink href={`/admin/ledger/transactions/${t.reverses.id}`}>
                  {humanize(t.reverses.reason)} · {dateTime.format(new Date(t.reverses.createdAt))}
                </RowLink>
              ) : (
                <span className="text-muted-foreground">nothing</span>
              )}
            </Row>
            <Row label="Reversed by">
              {t.reversedBy.length === 0 ? (
                <span className="text-muted-foreground">nothing</span>
              ) : (
                <span className="flex flex-col items-end gap-1">
                  {t.reversedBy.map((link) => (
                    <RowLink key={link.id} href={`/admin/ledger/transactions/${link.id}`}>
                      {humanize(link.reason)} · {dateTime.format(new Date(link.createdAt))}
                    </RowLink>
                  ))}
                </span>
              )}
            </Row>
          </dl>
        </Panel>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-muted-foreground shrink-0 text-[13px]">{label}</dt>
      <dd className="text-foreground min-w-0 text-right text-[13px]">{children}</dd>
    </div>
  );
}
