import type { Metadata } from "next";

import { SettingsPanel } from "@/components/account/settings-panel";
import { appRobots } from "@/lib/app-nav";

export const metadata: Metadata = { title: "Settings", robots: appRobots };

export default function SettingsPage() {
  return <SettingsPanel />;
}
