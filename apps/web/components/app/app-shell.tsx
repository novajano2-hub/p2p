import type { ReactNode } from "react";

import { AppHeader } from "@/components/app/app-header";
import { MobileTabBar } from "@/components/app/mobile-tab-bar";
import { AppLink } from "@/components/ui/app-link";
import { site } from "@/lib/site";

/*
  The chrome around every signed-in page: header, content column, legal footer
  on desktop, tab bar on smaller screens. The content column leaves room at the
  bottom for the tab bar where it exists, so nothing ends up underneath it.
*/
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="focus:rounded-control focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2"
      >
        Skip to content
      </a>

      <AppHeader />

      <main
        id="main"
        className="mx-auto w-full max-w-6xl flex-1 px-5 pt-6 pb-24 sm:px-8 sm:pt-8 lg:pb-12"
      >
        {children}
      </main>

      <footer className="hidden px-5 pb-8 lg:block">
        <nav
          aria-label="Legal"
          className="text-muted-foreground flex items-center justify-center gap-5 text-[13px]"
        >
          <span>
            &copy; {new Date().getFullYear()} {site.name}
          </span>
          <AppLink href="/terms" className="hover:text-foreground transition-colors duration-150">
            Terms
          </AppLink>
          <AppLink href="/privacy" className="hover:text-foreground transition-colors duration-150">
            Privacy
          </AppLink>
        </nav>
      </footer>

      <MobileTabBar />
    </>
  );
}
