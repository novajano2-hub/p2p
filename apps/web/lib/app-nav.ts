/*
  The signed-in app's map. One list, read by the desktop header and the mobile
  tab bar, so the two can never disagree about what the sections are or where
  they live. Icons are chosen where they are drawn (the tab bar), not here.
*/

export const appNav = [
  { label: "Home", href: "/account" },
  { label: "Trade", href: "/trade" },
  { label: "Orders", href: "/orders" },
  { label: "Wallet", href: "/wallet" },
] as const;

export const settingsHref = "/settings";

/** Every route behind a session. proxy.ts turns cookie-less visitors away from these. */
export const appRoutes = [...appNav.map((item) => item.href), settingsHref] as const;

/** A section is active on its own page and on anything nested under it. */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Nothing behind a session is ever indexed. */
export const appRobots = { index: false, follow: false } as const;
