"use client";

import { ArrowLeft } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { NeedsRole, useAdmin } from "@/components/admin/admin-shell";
import {
  Amount,
  Code,
  dateTime,
  Empty,
  humanize,
  integer,
  LoadMore,
  Notice,
  PageHeading,
  Panel,
  ReasonTag,
  RowLink,
  ScopeTag,
  Table,
  TD,
  TD_NUM,
  TH,
} from "@/components/admin/ledger-bits";
import { AppLink } from "@/components/ui/app-link";
import { ledgerClient, type LedgerAccount, type LedgerStatementRow } from "@/lib/admin/ledger";

/*
  One account and its statement: every entry ever posted against it, newest
  first, each with the balance it left behind - so the balance at the top is
  not a number the interface trusts but the last line of a column anyone can
  add up. Opening a customer's or a trade's account is recorded on the server:
  somebody's money is on screen, and who looked is a question with an answer.
*/

type State =
  | { status: "loading" }
  | {
      status: "ready";
      account: LedgerAccount;
      statement: LedgerStatementRow[];
      nextCursor: string | null;
      more: boolean;
    }
  | { status: "error"; message: string };

export function LedgerAccountView({ accountId }: { accountId: string }) {
  const admin = useAdmin();
  const may = admin.roles.includes("LEDGER_VIEWER");
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!may) return;
    let live = true;
    void ledgerClient.account(accountId).then((result) => {
      if (!live) return;
      setState(
        result.ok
          ? {
              status: "ready",
              account: result.account,
              statement: result.statement,
              nextCursor: result.nextCursor,
              more: false,
            }
          : { status: "error", message: result.message },
      );
    });
    return () => {
      live = false;
    };
  }, [may, accountId]);

  const loadMore = async () => {
    if (state.status !== "ready" || !state.nextCursor || state.more) return;
    const current = state;
    const cursor = state.nextCursor;
    setState({ ...current, more: true });
    const result = await ledgerClient.statement(accountId, { before: cursor });
    setState(
      result.ok
        ? {
            ...current,
            statement: [...current.statement, ...result.statement],
            nextCursor: result.nextCursor,
            more: false,
          }
        : { status: "error", message: result.message },
    );
  };

  const back = (
    <AppLink
      href="/admin/ledger/accounts"
      className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium transition-colors duration-150"
    >
      <ArrowLeft size={15} weight="bold" aria-hidden="true" />
      Accounts
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
          <Notice tone="loading">Loading the account&hellip;</Notice>
        ) : (
          <Notice tone="error">{state.message}</Notice>
        )}
      </>
    );
  }

  const { account, statement } = state;
  return (
    <>
      {back}
      <PageHeading
        title={humanize(account.purpose).replace(/^./, (c) => c.toUpperCase())}
        description={`${humanize(account.type)} account, ${account.scope.toLowerCase()} scope.`}
      />

      <Panel className="mb-6">
        <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
          <dl className="flex min-w-0 flex-col gap-2 text-[13px]">
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground">Code</dt>
              <dd>
                <Code className="text-foreground">{account.code}</Code>
              </dd>
            </div>
            {account.ownerId ? (
              <div className="flex flex-col gap-0.5">
                <dt className="text-muted-foreground">
                  {account.scope === "TRADE" ? "Trade" : "Customer"}
                </dt>
                <dd>
                  <Code>{account.ownerId}</Code>
                </dd>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <ScopeTag scope={account.scope} />
              <span className="text-muted-foreground text-[12px]">
                {account.allowsNegative ? "may go below zero" : "never below zero"} ·{" "}
                {integer.format(account.entryCount)} entries · opened{" "}
                {dateTime.format(new Date(account.createdAt))}
              </span>
            </div>
          </dl>
          <div className="text-left sm:text-right">
            <p className="text-muted-foreground text-[12px]">Balance (USDT)</p>
            <p className="text-foreground text-2xl leading-tight">
              <Amount value={account.balance} />
            </p>
            {account.lastTransactionId ? (
              <p className="mt-1 text-[12px]">
                <RowLink href={`/admin/ledger/transactions/${account.lastTransactionId}`}>
                  Last transaction
                </RowLink>
              </p>
            ) : null}
          </div>
        </div>
      </Panel>

      <Panel title="Statement">
        {statement.length === 0 ? (
          <Empty>Nothing has been posted to this account.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={TH}>When</th>
                <th className={TH}>Reason</th>
                <th className={TH}>Reference</th>
                <th className={`${TH} text-right`}>Debit</th>
                <th className={`${TH} text-right`}>Credit</th>
                <th className={`${TH} text-right`}>Balance after</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {statement.map((row) => (
                <tr key={row.entryId} className="border-border border-t">
                  <td className={`${TD} text-muted-foreground whitespace-nowrap tabular-nums`}>
                    {dateTime.format(new Date(row.createdAt))}
                  </td>
                  <td className={TD}>
                    <ReasonTag reason={row.reason} />
                  </td>
                  <td className={TD}>
                    <span className="text-muted-foreground">{row.referenceType} </span>
                    <Code>{row.referenceId}</Code>
                  </td>
                  <td className={TD_NUM}>
                    {row.direction === "DEBIT" ? <Amount value={row.amount} /> : null}
                  </td>
                  <td className={TD_NUM}>
                    {row.direction === "CREDIT" ? <Amount value={row.amount} /> : null}
                  </td>
                  <td className={TD_NUM}>
                    <Amount value={row.balanceAfter} />
                  </td>
                  <td className={`${TD} text-right`}>
                    <RowLink href={`/admin/ledger/transactions/${row.transactionId}`}>
                      Transaction
                    </RowLink>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <LoadMore cursor={state.nextCursor} busy={state.more} onClick={() => void loadMore()} />
      </Panel>
    </>
  );
}
