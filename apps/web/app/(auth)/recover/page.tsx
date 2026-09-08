import type { Metadata } from "next";

import { RecoverFlow } from "@/components/auth/recover-flow";

export const metadata: Metadata = { title: "Reset your password" };

export default function RecoverPage() {
  return <RecoverFlow />;
}
