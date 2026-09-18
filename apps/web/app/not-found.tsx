import { Compass } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";

import { Fallback } from "@/components/app/fallback";
import { Logo } from "@/components/brand/logo";
import { AppLink } from "@/components/ui/app-link";
import { ButtonLink } from "@/components/ui/button";
import { site } from "@/lib/site";

/*
  An address that matches no page at all. It renders inside the root layout
  only - no app header, no landing header - so it carries the logo itself,
  as the way home. "Home" is the front door for everybody: the proxy sends a
  signed-in person on from there to their account.
*/
export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main id="main" className="flex flex-1 flex-col items-center justify-center px-5 py-10">
      <AppLink href="/" aria-label={`${site.name} home`} className="mb-2">
        <Logo className="h-7 w-auto" />
      </AppLink>
      <Fallback
        icon={Compass}
        title="This page does not exist"
        actions={
          <ButtonLink href="/" arrow={false}>
            Go to the home page
          </ButtonLink>
        }
      >
        The link may be wrong, or the page may have moved.
      </Fallback>
    </main>
  );
}
