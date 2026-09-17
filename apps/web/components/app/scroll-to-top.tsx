"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

/*
  Every forward navigation starts at the top of the new page.

  The router only scrolls when the top of the new page is out of view, and it
  decides that at the moment the new page first paints - which, for a screen
  that fetches its own data, is a short "Loading…" panel. The browser has
  already clamped the old scroll offset to that short page; the panel then
  grows into the real screen, and the person is left somewhere in the middle
  of it. This scrolls on the path change itself, before the data arrives, so
  there is nothing left to clamp.

  Back and Forward are left alone: returning to where you were is what those
  buttons mean, and the browser restores it. A change to the query string
  alone (the market's ?want=) is the same page and does not scroll either.
*/

/** One string for a location, so a pop's destination can be compared to a render's. */
const keyOf = (pathname: string, query: string): string => {
  const normalised = new URLSearchParams(query).toString();
  return normalised ? `${pathname}?${normalised}` : pathname;
};

export function ScrollToTop() {
  const pathname = usePathname();
  const params = useSearchParams();
  const shown = useRef<{ pathname: string; key: string } | null>(null);
  // Where the last Back or Forward went. `popstate` fires with the address
  // already changed, before the router has rendered it, so by the time the
  // effect below sees that address it knows not to scroll.
  const popTarget = useRef<string | null>(null);

  useEffect(() => {
    const onPop = () => {
      popTarget.current = keyOf(window.location.pathname, window.location.search);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const here = keyOf(pathname, params.toString());
    const before = shown.current;
    shown.current = { pathname, key: here };
    // The first render is the page the browser just loaded, at whatever
    // position it chose (a hash, or a reload's restored offset).
    if (before === null) return;
    // Only the query changed: same page, same place.
    if (before.pathname === pathname) return;
    const pop = popTarget.current;
    popTarget.current = null;
    if (pop === here) return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname, params]);

  return null;
}
