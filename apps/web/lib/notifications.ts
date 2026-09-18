import type { NotificationType } from "@/lib/auth/client";

/*
  How each kind of news reads: good news, news that asks for care, or simply
  news. The bell colours its icon by it and a toast picks its kind by it, from
  this one table, so the two never disagree about the same notification.

  A dispute's decision is plain news rather than good news: it goes to both
  sides, and one of them lost.
*/

export type Tone = "good" | "warn" | "note";

export const NOTIFICATION_TONES: Record<NotificationType, Tone> = {
  KYC_APPROVED: "good",
  KYC_REJECTED: "warn",
  DEPOSIT_CREDITED: "good",
  WITHDRAWAL_SENT: "good",
  WITHDRAWAL_RETURNED: "warn",
  TRADE_OPENED: "note",
  TRADE_PAID: "note",
  TRADE_RELEASED: "good",
  TRADE_CANCELLED: "warn",
  TRADE_EXPIRED: "warn",
  DISPUTE_OPENED: "warn",
  DISPUTE_WITHDRAWN: "note",
  DISPUTE_RESOLVED: "note",
  OFFER_HIDDEN: "warn",
  OFFER_PAUSED: "warn",
};

/** The tone of a type this build may not know yet: a newer server can add one. */
export function toneOf(type: string): Tone {
  return Object.hasOwn(NOTIFICATION_TONES, type)
    ? NOTIFICATION_TONES[type as NotificationType]
    : "note";
}
