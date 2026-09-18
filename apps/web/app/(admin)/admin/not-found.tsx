"use client";

import { MagnifyingGlass } from "@phosphor-icons/react";
import { usePathname } from "next/navigation";

import { AdminShell } from "@/components/admin/admin-shell";
import { DocumentTitle } from "@/components/app/document-title";
import { Fallback } from "@/components/app/fallback";
import { ButtonLink } from "@/components/ui/button";
import { site } from "@/lib/site";

/*
  An admin page for something that is not there: an id typed or pasted wrong,
  or a link from an old note. The screens call notFound() when the API says
  so; this keeps the admin bar and the session check around it, and points
  back at the queue the item would have been in.
*/

const PLACES = [
  {
    prefix: "/admin/submissions/",
    noun: "verification submission",
    back: ["Verification", "/admin"],
  },
  { prefix: "/admin/deposits/", noun: "deposit", back: ["Deposits", "/admin/deposits"] },
  {
    prefix: "/admin/withdrawals/",
    noun: "withdrawal",
    back: ["Withdrawals", "/admin/withdrawals"],
  },
  { prefix: "/admin/disputes/", noun: "dispute", back: ["Disputes", "/admin/disputes"] },
  {
    prefix: "/admin/reconciliation/breaks/",
    noun: "reconciliation break",
    back: ["Reconciliation", "/admin/reconciliation"],
  },
  {
    prefix: "/admin/ledger/accounts/",
    noun: "ledger account",
    back: ["Ledger accounts", "/admin/ledger/accounts"],
  },
  {
    prefix: "/admin/ledger/transactions/",
    noun: "ledger transaction",
    back: ["Ledger transactions", "/admin/ledger/transactions"],
  },
] as const;

export default function AdminNotFound() {
  const pathname = usePathname();
  const place = PLACES.find((candidate) => pathname.startsWith(candidate.prefix));
  const [label, href] = place?.back ?? ["The queues", "/admin"];
  const missing = place ? place.noun.charAt(0).toUpperCase() + place.noun.slice(1) : "Page";

  return (
    <AdminShell>
      <DocumentTitle title={`${missing} not found | ${site.name} administration`} />
      <Fallback
        icon={MagnifyingGlass}
        title={place ? `No such ${place.noun}` : "This page does not exist"}
        actions={
          <ButtonLink href={href} arrow={false}>
            {label}
          </ButtonLink>
        }
      >
        The link may be wrong, or the id was mistyped. Nothing was changed.
      </Fallback>
    </AdminShell>
  );
}
