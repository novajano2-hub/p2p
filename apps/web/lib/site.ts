/**
 * Brand and site configuration. Everything brand-specific reads from here.
 */
export const site = {
  name: "BIRQ",
  tagline: "Trade USDT for birr, held in escrow.",
  description:
    "A peer-to-peer marketplace for buying and selling USDT with Ethiopian birr. The USDT is locked in escrow when a trade starts and released only when you confirm the birr arrived.",
  locale: "en",
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

/**
 * Where a successful sign-up or log-in lands. One constant, so the two flows
 * cannot disagree about it.
 */
export const afterAuth = "/account";
