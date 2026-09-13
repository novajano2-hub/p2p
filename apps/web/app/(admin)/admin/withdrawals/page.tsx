import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { WithdrawalQueue } from "@/components/admin/withdrawal-queue";

export const metadata: Metadata = { title: "Withdrawals" };

export default function AdminWithdrawalsPage() {
  return (
    <AdminShell>
      <WithdrawalQueue />
    </AdminShell>
  );
}
