import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { DepositQueue } from "@/components/admin/deposit-queue";

export const metadata: Metadata = { title: "Deposits" };

export default function AdminDepositsPage() {
  return (
    <AdminShell>
      <DepositQueue />
    </AdminShell>
  );
}
