import type { KycDocumentKind, KycDocumentType, KycStatus } from "@/lib/auth/client";

/*
  The words and numbers the verification screens use. The tiers and the
  photograph rules mirror @abay/contracts rather than importing it: the
  browser bundle stays independent of the API's build, the same way the
  password rules do. If the server's figures change, change these too - they
  are a promise made to the customer, and the server is what enforces it.

  Only Ethiopian documents are verified, so there is no country to choose:
  this is a marketplace for birr, and the person reviewing knows what an
  Ethiopian ID looks like.
*/

export const DOCUMENT_LABELS: Record<KycDocumentType, string> = {
  NATIONAL_ID: "National ID card",
  PASSPORT: "Passport",
  DRIVERS_LICENSE: "Driver's licence",
};

/** The choice the first step offers, in the order most people will hold one. */
export const DOCUMENT_OPTIONS: readonly {
  type: KycDocumentType;
  label: string;
  detail: string;
}[] = [
  {
    type: "NATIONAL_ID",
    label: DOCUMENT_LABELS.NATIONAL_ID,
    detail: "Fayda, or a kebele or city ID card. Front and back.",
  },
  {
    type: "PASSPORT",
    label: DOCUMENT_LABELS.PASSPORT,
    detail: "Ethiopian passport. The page with your photo.",
  },
  {
    type: "DRIVERS_LICENSE",
    label: DOCUMENT_LABELS.DRIVERS_LICENSE,
    detail: "Front and back.",
  },
];

/** Mirrors requiredDocumentKinds on the server: a passport is one page, a card has a back. */
export function requiredKinds(type: KycDocumentType): readonly KycDocumentKind[] {
  return type === "PASSPORT" ? ["FRONT", "SELFIE"] : ["FRONT", "BACK", "SELFIE"];
}

/** What each photograph is called, and how to take one that passes. */
export const PHOTO_GUIDE: Record<KycDocumentKind, { title: string; hint: string }> = {
  FRONT: {
    title: "Front of your document",
    hint: "All four corners in the frame, no glare, and every word readable.",
  },
  BACK: {
    title: "Back of your document",
    hint: "The same again for the back.",
  },
  SELFIE: {
    title: "You, holding your document",
    hint: "Hold it beside your face in good light. No hat, no sunglasses, nobody else in the frame.",
  },
};

export const STATUS_LABELS: Record<KycStatus, string> = {
  NOT_STARTED: "Unverified",
  PENDING: "Under review",
  APPROVED: "Verified",
  REJECTED: "Verification failed",
};

const dollars = new Intl.NumberFormat("en-US");

/** "$5,000". Whole dollars, because the asset traded here is worth one; these are ceilings, not prices. */
export function formatUsd(amount: number): string {
  return "$" + dollars.format(amount);
}

/** PLACEHOLDER figures, mirroring KYC_TIERS on the server. */
export const TIERS = {
  unverified: { dailyTradeUsd: 100, dailyWithdrawalUsd: 100, canPostOffers: false },
  verified: { dailyTradeUsd: 5_000, dailyWithdrawalUsd: 2_000, canPostOffers: true },
} as const;

/** What verification is worth, as the three lines the customer is shown. */
export const UNLOCKS = [
  {
    title: "Post your own offers",
    detail: "Set your price and limits and let buyers come to you.",
  },
  {
    title: "Trade up to " + formatUsd(TIERS.verified.dailyTradeUsd) + " a day",
    detail: "Up from " + formatUsd(TIERS.unverified.dailyTradeUsd) + " while unverified.",
  },
  {
    title: "Withdraw up to " + formatUsd(TIERS.verified.dailyWithdrawalUsd) + " a day",
    detail: "Up from " + formatUsd(TIERS.unverified.dailyWithdrawalUsd) + " while unverified.",
  },
] as const;
