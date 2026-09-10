"use client";

import { ArrowsLeftRight, House, Receipt, UserCircle, Wallet } from "@phosphor-icons/react";
import { usePathname } from "next/navigation";

import { AppLink } from "@/components/ui/app-link";
import { appNav, isActivePath, settingsHref } from "@/lib/app-nav";
import { cn } from "@/lib/cn";

/*
  Bottom tab bar for phones and tablets, where the header has no room for a
  nav and a thumb reaches the bottom of the screen more easily than the top.
  The four app sections plus the account, which on desktop lives in the header
  menu instead. Sits above the home indicator on phones that have one.
*/

const ICONS: Record<string, typeof House> = {
  "/account": House,
  "/trade": ArrowsLeftRight,
  "/orders": Receipt,
  "/wallet": Wallet,
};

const TABS = [...appNav, { label: "Me", href: settingsHref }] as const;

export function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="border-border/80 bg-background/95 fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {TABS.map((tab) => {
          const Icon = ICONS[tab.href] ?? UserCircle;
          const active = isActivePath(pathname, tab.href);
          return (
            <li key={tab.href}>
              <AppLink
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-150",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon size={22} weight={active ? "fill" : "regular"} aria-hidden="true" />
                {tab.label}
              </AppLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
