import NextLink from "next/link";
import type { ComponentPropsWithoutRef } from "react";

type AppLinkProps = ComponentPropsWithoutRef<typeof NextLink>;

/*
  Same-page anchors go straight to the browser; everything else goes through
  the router.

  The App Router treats the first `#hash` click on a page as a navigation and
  resolves the scroll itself, which is where hash links intermittently land at
  the top of the document instead of at the anchor. The browser's own hash
  handling has no such step: it finds the id, applies scroll-margin-top, and
  scrolls. There is nothing to gain from routing a link that never leaves the
  page, so we don't.
*/
export function AppLink({ href, ...props }: AppLinkProps) {
  if (typeof href === "string" && href.startsWith("#")) {
    return <a href={href} {...(props as ComponentPropsWithoutRef<"a">)} />;
  }
  return <NextLink href={href} {...props} />;
}
