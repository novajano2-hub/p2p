import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { KycQueue } from "@/components/admin/kyc-queue";

export const metadata: Metadata = { title: "Verification queue" };

export default function AdminHomePage() {
  return (
    <AdminShell>
      <KycQueue />
    </AdminShell>
  );
}
