"use client";

import { useEffect, useState, type FormEvent } from "react";

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
  RowLink,
  ScopeTag,
  Table,
  TD,
  TD_NUM,
  TH,
} from "@/components/admin/ledger-bits";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import {
  ledgerClient,
  type AccountsFilter,
  type LedgerAccount,
  type LedgerAccountType,
  type LedgerScope,
} from "@/lib/admin/ledger";

/*
  Every account, filterable by what it is (scope, type), whose it is (owner)
  and what it is called (a substring of the code), fifty at a time in code
  order. The code is the account's name in the ledger's own terms
  (ledger-taxonomy.md 2): TYPE:SCOPE:OWNER:ASSET:PURPOSE.
*/

type Form = { scope: "" | LedgerScope; type: "" | LedgerAccountType; ownerId: string; q: string };
const EMPTY: Form = { scope: "", type: "", ownerId: "", q: "" };

const toFilter = (form: Form): AccountsFilter => ({
  scope: form.scope || undefined,
  type: form.type || undefined,
  ownerId: form.ownerId.trim() || undefined,
  q: form.q.trim() || undefined,
});

type State =
  | { status: "loading" }
  | { status: "ready"; accounts: LedgerAccount[]; nextCursor: string | null; more: boolean }
  | { status: "error"; message: string };

export function LedgerAccounts() {
  const admin = useAdmin();
  const may = admin.roles.includes("LEDGER_VIEWER");
  const [form, setForm] = useState<Form>(EMPTY);
  const [applied, setApplied] = useState<Form>(EMPTY);
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!may) return;
    let live = true;
    void ledgerClient.accounts(toFilter(applied)).then((result) => {
      if (!live) return;
      setState(
        result.ok
          ? {
              status: "ready",
              accounts: result.accounts,
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
    const result = await ledgerClient.accounts({
      ...toFilter(applied),
      cursor,
    });
    setState(
      result.ok
        ? {
            status: "ready",
            accounts: [...current.accounts, ...result.accounts],
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
    <PageHeading title="Accounts" description="Every account in the ledger, with its balance." />
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
        <Field label="Scope">
          {(control) => (
            <Select
              {...control}
              value={form.scope}
              onChange={(event) => setForm({ ...form, scope: event.target.value as Form["scope"] })}
            >
              <option value="">Any</option>
              <option value="USER">Customer</option>
              <option value="TRADE">Trade</option>
              <option value="PLATFORM">Platform</option>
            </Select>
          )}
        </Field>
        <Field label="Type">
          {(control) => (
            <Select
              {...control}
              value={form.type}
              onChange={(event) => setForm({ ...form, type: event.target.value as Form["type"] })}
            >
              <option value="">Any</option>
              <option value="ASSET">Asset</option>
              <option value="LIABILITY">Liability</option>
              <option value="EQUITY">Equity</option>
              <option value="REVENUE">Revenue</option>
              <option value="EXPENSE">Expense</option>
            </Select>
          )}
        </Field>
        <Field label="Owner id">
          {(control) => (
            <Input
              {...control}
              value={form.ownerId}
              placeholder="user or trade id"
              spellCheck={false}
              onChange={(event) => setForm({ ...form, ownerId: event.target.value })}
            />
          )}
        </Field>
        <Field label="Code contains">
          {(control) => (
            <Input
              {...control}
              value={form.q}
              placeholder="ESCROW"
              spellCheck={false}
              onChange={(event) => setForm({ ...form, q: event.target.value })}
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

      {state.status === "loading" ? <Notice tone="loading">Loading accounts&hellip;</Notice> : null}
      {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}

      {state.status === "ready" ? (
        <Panel>
          {state.accounts.length === 0 ? (
            <Empty>No account matches.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th className={TH}>Account</th>
                  <th className={TH}>Type</th>
                  <th className={`${TH} text-right`}>Balance (USDT)</th>
                  <th className={`${TH} text-right`}>Entries</th>
                  <th className={TH}>Last movement</th>
                  <th className={TH} />
                </tr>
              </thead>
              <tbody>
                {state.accounts.map((account) => (
                  <tr key={account.id} className="border-border border-t">
                    <td className={TD}>
                      <Code className="text-foreground">{account.code}</Code>
                      <div className="mt-1">
                        <ScopeTag scope={account.scope} />
                      </div>
                    </td>
                    <td className={`${TD} text-muted-foreground capitalize`}>
                      {humanize(account.type)}
                    </td>
                    <td className={TD_NUM}>
                      <Amount value={account.balance} />
                    </td>
                    <td className={TD_NUM}>{integer.format(account.entryCount)}</td>
                    <td className={`${TD} text-muted-foreground whitespace-nowrap tabular-nums`}>
                      {account.entryCount > 0 ? dateTime.format(new Date(account.updatedAt)) : "—"}
                    </td>
                    <td className={`${TD} text-right`}>
                      <RowLink href={`/admin/ledger/accounts/${account.id}`}>Statement</RowLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <LoadMore cursor={state.nextCursor} busy={state.more} onClick={() => void loadMore()} />
        </Panel>
      ) : null}
    </>
  );
}
