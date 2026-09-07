/**
 * Brand and site configuration.
 *
 * "Abay" is a PLACEHOLDER name (the Blue Nile). Everything brand-specific on the
 * marketing site reads from this file so the real name is a one-file change.
 */
export const site = {
  name: "Abay",
  tagline: "Trade USDT for birr, with escrow on every trade.",
  description:
    "A peer-to-peer marketplace for buying and selling USDT with Ethiopian birr. Your USDT is locked in escrow until you confirm the birr arrived.",
  locale: "en",
  isPlaceholderBrand: true,
} as const;

export const nav = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Fees", href: "#fees" },
  { label: "Safety", href: "#safety" },
  { label: "FAQ", href: "#faq" },
] as const;

/**
 * One label per intent, used everywhere on the page. "Create account" is the
 * only signup-intent label; "Log in" the only login-intent label.
 */
export const cta = {
  signup: { label: "Create account", href: "/register" },
  login: { label: "Log in", href: "/login" },
  learn: { label: "See how it works", href: "#how-it-works" },
} as const;
