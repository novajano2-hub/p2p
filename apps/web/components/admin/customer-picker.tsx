"use client";

import { MagnifyingGlass } from "@phosphor-icons/react";
import { useState } from "react";

import { Tag } from "@/components/admin/admin-bits";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { customersClient, type AdminCustomer } from "@/lib/admin/operations";

/*
  Finding the person a stray deposit belongs to.

  Search rather than a list: there is no sensible "all customers" screen to
  pick from, and the administrator always arrives here already knowing
  roughly who they are looking for - an account number from a support ticket,
  a username, an email. The account number is shown first in every result
  because that is the thing being matched against.

  Nothing is selected by accident: picking a customer only fills the box, and
  the attribution itself is a separate, deliberate act on the screen below.
*/

export function CustomerPicker({
  picked,
  onPick,
}: {
  picked: AdminCustomer | null;
  onPick: (customer: AdminCustomer | null) => void;
}) {
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ customers: AdminCustomer[]; truncated: boolean } | null>(
    null,
  );

  const run = async () => {
    if (term.trim().length < 2) return;
    setBusy(true);
    setError(null);
    const result = await customersClient.search(term.trim());
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      setResults(null);
      return;
    }
    setResults({ customers: result.customers, truncated: result.truncated });
  };

  if (picked) {
    return (
      <div className="rounded-control border-primary/40 bg-primary/5 flex items-start justify-between gap-3 border px-4 py-3">
        <div className="min-w-0">
          <p className="text-foreground font-mono text-[13px]">{picked.platformId}</p>
          <p className="text-muted-foreground mt-0.5 truncate text-[12px]">
            {picked.username} · {picked.email}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onPick(null)}
          className="text-muted-foreground hover:text-foreground shrink-0 text-[12px] font-medium underline-offset-2 hover:underline"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Who is it"
        hint="Account number, username, or email."
        error={error ?? undefined}
      >
        {(a11y) => (
          <div className="flex gap-2">
            <Input
              {...a11y}
              value={term}
              placeholder="BQ-12345678"
              autoComplete="off"
              onChange={(event) => setTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void run();
              }}
            />
            <Button
              type="button"
              variant="secondary"
              size="lg"
              loading={busy}
              disabled={term.trim().length < 2}
              onClick={() => void run()}
              aria-label="Search"
              className="shrink-0 px-3"
            >
              <MagnifyingGlass size={17} weight="bold" aria-hidden="true" />
            </Button>
          </div>
        )}
      </Field>

      {results && results.customers.length === 0 ? (
        <p className="text-muted-foreground text-[13px]">
          Nobody matches that. Try the account number exactly as it is written.
        </p>
      ) : null}

      {results && results.customers.length > 0 ? (
        <ul className="divide-border rounded-control border-border divide-y border">
          {results.customers.map((customer) => (
            <li key={customer.userId}>
              <button
                type="button"
                onClick={() => onPick(customer)}
                className="hover:bg-muted/50 flex w-full items-start justify-between gap-3 px-4 py-2.5 text-left transition-colors duration-150"
              >
                <span className="min-w-0">
                  <span className="text-foreground block font-mono text-[13px]">
                    {customer.platformId}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block truncate text-[12px]">
                    {customer.username} · {customer.email}
                  </span>
                </span>
                {customer.status === "ACTIVE" ? null : (
                  <Tag tone="attention">{customer.status.toLowerCase()}</Tag>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {results?.truncated ? (
        <p className="text-muted-foreground text-[12px]">
          More than twenty matched. Narrow the search before picking one.
        </p>
      ) : null}
    </div>
  );
}
