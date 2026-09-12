import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { LedgerAccountView } from "@/components/admin/ledger-account";

export const metadata: Metadata = { title: "Account statement" };

export default async function AdminLedgerAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AdminShell>
      <LedgerAccountView accountId={id} />
    </AdminShell>
  );
}
