import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { DisputeReview } from "@/components/admin/dispute-review";

export const metadata: Metadata = { title: "Dispute" };

export default async function AdminDisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AdminShell>
      <DisputeReview disputeId={id} />
    </AdminShell>
  );
}
