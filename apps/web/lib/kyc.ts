import type { KycDocumentType, KycStatus } from "@/lib/auth/client";

/*
  The words and numbers the verification screens use. The tiers mirror
  KYC_TIERS in @abay/contracts rather than importing it: the browser bundle
  stays independent of the API's build, the same way the password rules do.
  If the server's figures change, change these too - they are a promise made
  to the customer, and the server is what actually enforces it.
*/

export const DOCUMENT_LABELS: Record<KycDocumentType, string> = {
  NATIONAL_ID: "National ID",
  PASSPORT: "Passport",
  DRIVERS_LICENSE: "Driver's licence",
};

export const STATUS_LABELS: Record<KycStatus, string> = {
  NOT_STARTED: "Unverified",
  PENDING: "Under review",
  APPROVED: "Verified",
  REJECTED: "Verification failed",
};

/*
  Ethiopia first, because that is who this is for; the rest are the countries
  an Ethiopian passport holder abroad is most likely to be verifying from. A
  full ISO list would be a scrolling wall for a market this focused.
*/
export const COUNTRIES = [
  { code: "ET", name: "Ethiopia" },
  { code: "KE", name: "Kenya" },
  { code: "DJ", name: "Djibouti" },
  { code: "SO", name: "Somalia" },
  { code: "SD", name: "Sudan" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
] as const;

const birr = new Intl.NumberFormat("en-US");

/** "10,000 ETB". Whole birr: these are ceilings, not prices. */
export function formatEtb(amount: number): string {
  return birr.format(amount) + " ETB";
}

/** PLACEHOLDER figures, mirroring KYC_TIERS on the server. */
export const TIERS = {
  unverified: { dailyTradeEtb: 10_000, dailyWithdrawalEtb: 10_000, canPostOffers: false },
  verified: { dailyTradeEtb: 500_000, dailyWithdrawalEtb: 200_000, canPostOffers: true },
} as const;

/** What verification is worth, as the three lines the customer is shown. */
export const UNLOCKS = [
  {
    title: "Post your own offers",
    detail: "Set your price and limits and let buyers come to you.",
  },
  {
    title: "Trade up to " + formatEtb(TIERS.verified.dailyTradeEtb) + " a day",
    detail: "Up from " + formatEtb(TIERS.unverified.dailyTradeEtb) + " while unverified.",
  },
  {
    title: "Withdraw up to " + formatEtb(TIERS.verified.dailyWithdrawalEtb) + " a day",
    detail: "Up from " + formatEtb(TIERS.unverified.dailyWithdrawalEtb) + " while unverified.",
  },
] as const;
