import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { DepositReview } from "@/components/admin/deposit-review";

export const metadata: Metadata = { title: "Deposit" };

export default async function AdminDepositPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AdminShell>
      <DepositReview depositId={id} />
    </AdminShell>
  );
}
