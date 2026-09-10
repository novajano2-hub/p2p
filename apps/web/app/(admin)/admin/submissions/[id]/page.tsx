import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { KycReview } from "@/components/admin/kyc-review";

export const metadata: Metadata = { title: "Review" };

export default async function AdminSubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AdminShell>
      <KycReview submissionId={id} />
    </AdminShell>
  );
}
