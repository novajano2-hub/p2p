import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminLogin } from "@/components/admin/admin-login";

export const metadata: Metadata = { title: "Sign in" };

/* The form reads ?next= and ?why= on the client; Next wants the boundary for that. */
export default function AdminLoginPage() {
  return (
    <Suspense>
      <AdminLogin />
    </Suspense>
  );
}
