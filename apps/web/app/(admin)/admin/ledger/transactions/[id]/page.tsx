import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { LedgerTransactionView } from "@/components/admin/ledger-transaction";

export const metadata: Metadata = { title: "Transaction" };

export default async function AdminLedgerTransactionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AdminShell>
      <LedgerTransactionView transactionId={id} />
    </AdminShell>
  );
}
