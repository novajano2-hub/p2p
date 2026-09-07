import { AppLink } from "@/components/ui/app-link";

import { Logo } from "@/components/brand/logo";
import { MobileNav } from "@/components/marketing/mobile-nav";
import { ButtonLink } from "@/components/ui/button";
import { cta, nav } from "@/lib/site";

/*
  z-index scale for the marketing site:
    header      40
    mobile menu 50
  Nothing else on these pages sets a z-index.
*/
export function SiteHeader() {
  return (
    <header className="border-border/80 bg-background/85 sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <AppLink href="/" aria-label="Home" className="rounded-control">
          <Logo />
        </AppLink>

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {nav.map((item) => (
            <AppLink
              key={item.href}
              href={item.href}
              className="rounded-control text-muted-foreground hover:text-foreground px-3 py-2 text-[15px] transition-colors duration-150"
            >
              {item.label}
            </AppLink>
          ))}
        </nav>

        <div className="hidden items-center gap-4 lg:flex">
          <AppLink
            href={cta.login.href}
            className="rounded-control text-foreground hover:text-primary px-1 text-[15px] transition-colors duration-150"
          >
            {cta.login.label}
          </AppLink>
          <ButtonLink href={cta.signup.href} size="sm">
            {cta.signup.label}
          </ButtonLink>
        </div>

        <MobileNav />
      </div>
    </header>
  );
}
