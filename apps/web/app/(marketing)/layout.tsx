import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

/*
  Marketing shell. This route group must never import from the API client or
  money modules; scripts/check-boundaries.mjs enforces it in CI.
*/
export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <a
        href="#main"
        className="focus:rounded-control focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
