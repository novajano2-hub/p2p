"use client";

import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";

import { NeedsRole, useAdmin } from "@/components/admin/admin-shell";
import {
  Amount,
  dateTime,
  humanize,
  integer,
  Notice,
  PageHeading,
  Panel,
  RowLink,
  Table,
  TD,
  TD_NUM,
  TH,
} from "@/components/admin/ledger-bits";
import { ButtonLink } from "@/components/ui/button";
import { ledgerClient, type LedgerOverview as Overview } from "@/lib/admin/ledger";

/*
  The first ledger screen answers one question before any other: is the
  ledger consistent right now. Four checks, each of which the database
  itself enforces, re-verified from the rows on every load - because "the
  constraint should have stopped it" is a claim, and this is where the claim
  is checked. Below that, what the ledger holds, in aggregate: nobody is
  named here, which is why any LEDGER_VIEWER may see it without a record.
*/

type State =
  | { status: "loading" }
  | { status: "ready"; overview: Overview }
  | { status: "error"; message: string };

export function LedgerOverview() {
  const admin = useAdmin();
  const may = admin.roles.includes("LEDGER_VIEWER");
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!may) return;
    let live = true;
    void ledgerClient.overview().then((result) => {
      if (!live) return;
      setState(
        result.ok
          ? { status: "ready", overview: result.overview }
          : { status: "error", message: result.message },
      );
    });
    return () => {
      live = false;
    };
  }, [may]);

  const heading = (
    <PageHeading
      title="Ledger"
      description="Every balance, and the entries that made it."
      actions={
        <>
          <ButtonLink href="/admin/ledger/accounts" variant="secondary" size="sm" arrow={false}>
            Accounts
          </ButtonLink>
          <ButtonLink href="/admin/ledger/transactions" variant="secondary" size="sm" arrow={false}>
            Transactions
          </ButtonLink>
        </>
      }
    />
  );

  if (!may) {
    return (
      <>
        {heading}
        <NeedsRole role="LEDGER_VIEWER" />
      </>
    );
  }
  if (state.status !== "ready") {
    return (
      <>
        {heading}
        {state.status === "loading" ? (
          <Notice tone="loading">Checking the ledger&hellip;</Notice>
        ) : (
          <Notice tone="error">{state.message}</Notice>
        )}
      </>
    );
  }

  const { health, totals, trialBalance, equation, platform, customers, trades } = state.overview;
  const checks = [
    {
      ok: health.balanced,
      label: "Every transaction balances",
      detail: health.balanced
        ? "debits equal credits in all of them"
        : `${integer.format(health.unbalancedTransactions)} do not`,
    },
    {
      ok: health.projectionDrift === 0,
      label: "Balances match their entries",
      detail:
        health.projectionDrift === 0
          ? "a rebuild would change nothing"
          : `${integer.format(health.projectionDrift)} account(s) differ`,
    },
    {
      ok: health.floorBreaches === 0,
      label: "No customer or trade below zero",
      detail:
        health.floorBreaches === 0
          ? "the floor holds everywhere"
          : `${integer.format(health.floorBreaches)} breach(es)`,
    },
    {
      ok: equation.holds,
      label: "The books balance",
      detail: "assets and expenses equal liabilities, equity and revenue",
    },
  ];

  return (
    <>
      {heading}
      <div className="flex flex-col gap-6">
        <section aria-label="Consistency" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {checks.map((check) => (
            <div
              key={check.label}
              className={
                check.ok
                  ? "rounded-surface bg-status-complete text-status-complete-fg flex gap-2.5 px-4 py-3"
                  : "rounded-surface bg-status-attention text-status-attention-fg flex gap-2.5 px-4 py-3"
              }
            >
              {check.ok ? (
                <CheckCircle
                  size={18}
                  weight="fill"
                  aria-hidden="true"
                  className="mt-0.5 shrink-0"
                />
              ) : (
                <WarningCircle
                  size={18}
                  weight="fill"
                  aria-hidden="true"
                  className="mt-0.5 shrink-0"
                />
              )}
              <div>
                <p className="text-[13px] font-semibold">{check.label}</p>
                <p className="text-[12px] opacity-80">{check.detail}</p>
              </div>
            </div>
          ))}
        </section>

        <p className="text-muted-foreground text-[13px] tabular-nums">
          {integer.format(totals.accounts)} accounts · {integer.format(totals.transactions)}{" "}
          transactions · {integer.format(totals.entries)} entries · last posted{" "}
          {totals.lastPostedAt ? dateTime.format(new Date(totals.lastPostedAt)) : "never"} · checked{" "}
          {dateTime.format(new Date(state.overview.checkedAt))}
        </p>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Trial balance">
            <Table>
              <thead>
                <tr>
                  <th className={TH}>Type</th>
                  <th className={`${TH} text-right`}>Accounts</th>
                  <th className={`${TH} text-right`}>Balance (USDT)</th>
                </tr>
              </thead>
              <tbody>
                {trialBalance.map((row) => (
                  <tr key={row.type} className="border-border border-t">
                    <td className={`${TD} capitalize`}>{humanize(row.type)}</td>
                    <td className={TD_NUM}>{integer.format(row.accounts)}</td>
                    <td className={TD_NUM}>
                      <Amount value={row.balance} />
                    </td>
                  </tr>
                ))}
                <tr className="border-border bg-muted/40 border-t">
                  <td className={`${TD} font-medium`}>Assets + expenses</td>
                  <td className={TD} />
                  <td className={TD_NUM}>
                    <Amount value={equation.debitSide} />
                  </td>
                </tr>
                <tr className="border-border bg-muted/40 border-t">
                  <td className={`${TD} font-medium`}>Liabilities + equity + revenue</td>
                  <td className={TD} />
                  <td className={TD_NUM}>
                    <Amount value={equation.creditSide} />
                  </td>
                </tr>
              </tbody>
            </Table>
          </Panel>

          <Panel title="Customers and trades">
            <dl className="divide-border divide-y px-4">
              <Row label="Customers with an account">{integer.format(customers.count)}</Row>
              <Row label="Available to customers">
                <Amount value={customers.available} />
              </Row>
              <Row label="Held for withdrawal">
                <Amount value={customers.pendingWithdrawal} />
              </Row>
              <Row label="Trades holding escrow">{integer.format(trades.open)}</Row>
              <Row label="In escrow">
                <Amount value={trades.escrowed} />
              </Row>
            </dl>
          </Panel>
        </div>

        <Panel title="Platform accounts">
          <Table>
            <thead>
              <tr>
                <th className={TH}>Purpose</th>
                <th className={TH}>Type</th>
                <th className={`${TH} text-right`}>Balance (USDT)</th>
                <th className={`${TH} text-right`}>Entries</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {platform.map((account) => (
                <tr key={account.id} className="border-border border-t">
                  <td className={`${TD} font-medium capitalize`}>{humanize(account.purpose)}</td>
                  <td className={`${TD} text-muted-foreground capitalize`}>
                    {humanize(account.type)}
                  </td>
                  <td className={TD_NUM}>
                    <Amount value={account.balance} />
                  </td>
                  <td className={TD_NUM}>{integer.format(account.entryCount)}</td>
                  <td className={`${TD} text-right`}>
                    <RowLink href={`/admin/ledger/accounts/${account.id}`}>Statement</RowLink>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-muted-foreground shrink-0 text-[13px]">{label}</dt>
      <dd className="text-foreground text-right text-[13px] tabular-nums">{children}</dd>
    </div>
  );
}
