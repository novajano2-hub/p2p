"use client";

import { useEffect, useState, type FormEvent } from "react";

import { NeedsRole, useAdmin } from "@/components/admin/admin-shell";
import {
  Amount,
  Code,
  dateTime,
  Empty,
  humanize,
  LoadMore,
  Notice,
  PageHeading,
  Panel,
  ReasonTag,
  RowLink,
} from "@/components/admin/admin-bits";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import {
  LEDGER_REASONS,
  ledgerClient,
  type LedgerReason,
  type LedgerTransaction,
  type TransactionsFilter,
} from "@/lib/admin/ledger";

/*
  The journal: every transaction, newest first, each shown as the lines it
  posted so a reader sees the double entry rather than a summary of it.
  Filters follow how a question arrives - "what happened to trade X", "what
  did request Y do", "show me every escrow lock" - by reference, by
  correlation id, by reason.
*/

type Form = {
  reason: "" | LedgerReason;
  referenceType: string;
  referenceId: string;
  correlationId: string;
};
const EMPTY: Form = { reason: "", referenceType: "", referenceId: "", correlationId: "" };

const toFilter = (form: Form): TransactionsFilter => ({
  reason: form.reason || undefined,
  referenceType: form.referenceType.trim() || undefined,
  referenceId: form.referenceId.trim() || undefined,
  correlationId: form.correlationId.trim() || undefined,
});

type State =
  | { status: "loading" }
  | { status: "ready"; transactions: LedgerTransaction[]; nextCursor: string | null; more: boolean }
  | { status: "error"; message: string };

export function LedgerTransactions() {
  const admin = useAdmin();
  const may = admin.roles.includes("LEDGER_VIEWER");
  const [form, setForm] = useState<Form>(EMPTY);
  const [applied, setApplied] = useState<Form>(EMPTY);
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!may) return;
    let live = true;
    void ledgerClient.transactions(toFilter(applied)).then((result) => {
      if (!live) return;
      setState(
        result.ok
          ? {
              status: "ready",
              transactions: result.transactions,
              nextCursor: result.nextCursor,
              more: false,
            }
          : { status: "error", message: result.message },
      );
    });
    return () => {
      live = false;
    };
  }, [may, applied]);

  const loadMore = async () => {
    if (state.status !== "ready" || !state.nextCursor || state.more) return;
    const current = state;
    const cursor = state.nextCursor;
    setState({ ...current, more: true });
    const result = await ledgerClient.transactions({
      ...toFilter(applied),
      cursor,
    });
    setState(
      result.ok
        ? {
            status: "ready",
            transactions: [...current.transactions, ...result.transactions],
            nextCursor: result.nextCursor,
            more: false,
          }
        : { status: "error", message: result.message },
    );
  };

  const apply = (event: FormEvent) => {
    event.preventDefault();
    setState({ status: "loading" });
    setApplied(form);
  };
  const clear = () => {
    setForm(EMPTY);
    setState({ status: "loading" });
    setApplied(EMPTY);
  };

  const heading = (
    <PageHeading title="Transactions" description="The journal, newest first, as it was posted." />
  );
  if (!may) {
    return (
      <>
        {heading}
        <NeedsRole role="LEDGER_VIEWER" />
      </>
    );
  }

  return (
    <>
      {heading}
      <form onSubmit={apply} className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Reason">
          {(control) => (
            <Select
              {...control}
              value={form.reason}
              onChange={(event) =>
                setForm({ ...form, reason: event.target.value as Form["reason"] })
              }
            >
              <option value="">Any</option>
              {LEDGER_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {humanize(reason)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Reference type">
          {(control) => (
            <Input
              {...control}
              value={form.referenceType}
              placeholder="trade"
              spellCheck={false}
              onChange={(event) => setForm({ ...form, referenceType: event.target.value })}
            />
          )}
        </Field>
        <Field label="Reference id">
          {(control) => (
            <Input
              {...control}
              value={form.referenceId}
              spellCheck={false}
              onChange={(event) => setForm({ ...form, referenceId: event.target.value })}
            />
          )}
        </Field>
        <Field label="Correlation id">
          {(control) => (
            <Input
              {...control}
              value={form.correlationId}
              spellCheck={false}
              onChange={(event) => setForm({ ...form, correlationId: event.target.value })}
            />
          )}
        </Field>
        <div className="flex items-end gap-2">
          <Button type="submit" size="md" className="h-11">
            Apply
          </Button>
          <Button type="button" variant="secondary" size="md" className="h-11" onClick={clear}>
            Clear
          </Button>
        </div>
      </form>

      {state.status === "loading" ? (
        <Notice tone="loading">Loading transactions&hellip;</Notice>
      ) : null}
      {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}

      {state.status === "ready" ? (
        <Panel>
          {state.transactions.length === 0 ? (
            <Empty>No transaction matches.</Empty>
          ) : (
            <ul className="divide-border divide-y">
              {state.transactions.map((transaction) => (
                <li key={transaction.id} className="px-4 py-3">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <ReasonTag reason={transaction.reason} />
                      <span className="text-[13px]">
                        <span className="text-muted-foreground">{transaction.referenceType} </span>
                        <Code>{transaction.referenceId}</Code>
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[12px]">
                      <span className="text-muted-foreground whitespace-nowrap tabular-nums">
                        {dateTime.format(new Date(transaction.createdAt))}
                      </span>
                      <RowLink href={`/admin/ledger/transactions/${transaction.id}`}>Open</RowLink>
                    </div>
                  </div>
                  <table className="mt-2 w-full text-[12px]">
                    <tbody>
                      {transaction.entries.map((entry) => (
                        <tr key={entry.id}>
                          <td className="text-muted-foreground w-8 pr-2">
                            {entry.direction === "DEBIT" ? "Dr" : "Cr"}
                          </td>
                          <td className={entry.direction === "CREDIT" ? "pl-6" : ""}>
                            <Code>{entry.accountCode}</Code>
                          </td>
                          <td className="text-right font-mono whitespace-nowrap tabular-nums">
                            <Amount value={entry.amount} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </li>
              ))}
            </ul>
          )}
          <LoadMore cursor={state.nextCursor} busy={state.more} onClick={() => void loadMore()} />
        </Panel>
      ) : null}
    </>
  );
}
