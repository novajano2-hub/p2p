import { AppLink } from "@/components/ui/app-link";
import { site } from "@/lib/site";

/*
  Shell for the signed-in app. It is the auth shell for now, because the only
  screen behind it is a single card; the real app chrome (navigation, balance
  header, theme control) arrives with Phase 2 and replaces this file.
*/
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <a
        href="#main"
        className="focus:rounded-control focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <main
        id="main"
        className="flex flex-1 flex-col items-center justify-center px-5 py-10 sm:py-16"
      >
        <div className="w-full max-w-[27rem]">{children}</div>
      </main>
      <footer className="px-5 pb-8">
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
    </>
  );
}
