import type { Metadata } from "next";

import { AccountHome } from "@/components/account/account-home";
import { appRobots } from "@/lib/app-nav";

export const metadata: Metadata = { title: "Home", robots: appRobots };

export default function AccountPage() {
  return <AccountHome />;
}
