import type { Metadata } from "next";

import { SessionPanel } from "@/components/account/session-panel";

export const metadata: Metadata = {
  title: "Your account",
  // Nothing behind a session should ever be indexed.
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return <SessionPanel />;
}
