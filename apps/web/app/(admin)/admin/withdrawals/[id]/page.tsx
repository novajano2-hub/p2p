import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { WithdrawalReview } from "@/components/admin/withdrawal-review";

export const metadata: Metadata = { title: "Withdrawal" };

export default async function AdminWithdrawalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AdminShell>
      <WithdrawalReview withdrawalId={id} />
    </AdminShell>
  );
}
