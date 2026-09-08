import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginFlow } from "@/components/auth/login-flow";

export const metadata: Metadata = { title: "Log in" };

/*
  The flow reads ?error= (how a failed Google sign-in reports back), which is
  a client-side read of the URL; Next requires the boundary so the rest of the
  page can still be prerendered.
*/
export default function LoginPage() {
  return (
    <Suspense>
      <LoginFlow />
    </Suspense>
  );
}
