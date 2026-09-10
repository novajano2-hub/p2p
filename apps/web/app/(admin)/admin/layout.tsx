import type { Metadata } from "next";
import type { ReactNode } from "react";

/*
  The admin area's own root. Deliberately thin: the gate and the chrome are in
  AdminShell, and the sign-in page must not sit behind the gate that would
  send it to itself.
*/
export const metadata: Metadata = {
  title: { default: "Administration", template: "%s | BIRQ administration" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-full flex-1 flex-col">{children}</div>;
}
