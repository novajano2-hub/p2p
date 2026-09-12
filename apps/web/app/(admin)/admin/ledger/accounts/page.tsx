import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { LedgerAccounts } from "@/components/admin/ledger-accounts";

export const metadata: Metadata = { title: "Ledger accounts" };

export default function AdminLedgerAccountsPage() {
  return (
    <AdminShell>
      <LedgerAccounts />
    </AdminShell>
  );
}
