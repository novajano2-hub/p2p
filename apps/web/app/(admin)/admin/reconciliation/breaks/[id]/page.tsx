import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { ReconciliationBreakView } from "@/components/admin/reconciliation-break";

export const metadata: Metadata = { title: "Break" };

export default async function AdminBreakPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AdminShell>
      <ReconciliationBreakView breakId={id} />
    </AdminShell>
  );
}
