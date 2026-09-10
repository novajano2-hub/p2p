"use client";

import { usePathname } from "next/navigation";

import { AccountMenu } from "@/components/app/account-menu";
import { NotificationBell } from "@/components/app/notification-bell";
import { Logo } from "@/components/brand/logo";
import { AppLink } from "@/components/ui/app-link";
import { ButtonLink } from "@/components/ui/button";
import { appNav, isActivePath } from "@/lib/app-nav";
import { cn } from "@/lib/cn";
import { afterAuth } from "@/lib/site";

/*
  The signed-in header. Same bones as the marketing header (64px, blurred
  canvas, one container width) so moving between the two never feels like
  changing sites; different contents, because a customer has sections to move
  between and an account to manage, not a pitch to read.

  z-index scale for the app:
    header         40
    mobile tab bar 40
    account menu   50
*/
export function AppHeader() {
  const pathname = usePathname();

  return (
    <header className="border-border/80 bg-background/85 sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-5 sm:px-8">
        <AppLink href={afterAuth} aria-label="Home" className="rounded-control">
          <Logo />
        </AppLink>

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {appNav.map((item) => {
            const active = isActivePath(pathname, item.href);
            return (
              <AppLink
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-control px-3 py-2 text-[15px] transition-colors duration-150",
                  active
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </AppLink>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <ButtonLink href="/wallet" size="sm" arrow={false} className="hidden sm:inline-flex">
            Deposit
          </ButtonLink>
          <NotificationBell />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
