import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { DisputeQueue } from "@/components/admin/dispute-queue";

export const metadata: Metadata = { title: "Disputes" };

export default function AdminDisputesPage() {
  return (
    <AdminShell>
      <DisputeQueue />
    </AdminShell>
  );
}
