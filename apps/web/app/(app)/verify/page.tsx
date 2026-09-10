import type { Metadata } from "next";

import { VerifyFlow } from "@/components/account/verify-flow";
import { appRobots } from "@/lib/app-nav";

export const metadata: Metadata = { title: "Verify your identity", robots: appRobots };

export default function VerifyPage() {
  return <VerifyFlow />;
}
