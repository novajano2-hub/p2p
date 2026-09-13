import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { Reconciliation } from "@/components/admin/reconciliation";

export const metadata: Metadata = { title: "Reconciliation" };

export default function AdminReconciliationPage() {
  return (
    <AdminShell>
      <Reconciliation />
    </AdminShell>
  );
}
