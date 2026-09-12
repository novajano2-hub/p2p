import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { LedgerOverview } from "@/components/admin/ledger-overview";

export const metadata: Metadata = { title: "Ledger" };

export default function AdminLedgerPage() {
  return (
    <AdminShell>
      <LedgerOverview />
    </AdminShell>
  );
}
