import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { LedgerTransactions } from "@/components/admin/ledger-transactions";

export const metadata: Metadata = { title: "Ledger transactions" };

export default function AdminLedgerTransactionsPage() {
  return (
    <AdminShell>
      <LedgerTransactions />
    </AdminShell>
  );
}
