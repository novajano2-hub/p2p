import { z } from "zod";

/*
  What a customer is told without doing anything on this device.

  Minimal on purpose: today the only thing that generates one is a KYC
  decision, written by AdminKycService in the same transaction as the
  decision itself, so a notification can never exist for a decision that did
  not happen or disagree with one that did. Every other kind of notice this
  platform will eventually need - a trade needing attention, a dispute
  decided, a deposit arriving - is a new value in the enum below and a new
  call site, not a new system.
*/

export const notificationType = z.enum([
  "KYC_APPROVED",
  "KYC_REJECTED",
  "DEPOSIT_CREDITED",
  "WITHDRAWAL_SENT",
  "WITHDRAWAL_RETURNED",
]);
export type NotificationType = z.infer<typeof notificationType>;

export const notificationItem = z.object({
  id: z.string(),
  type: notificationType,
  title: z.string(),
  body: z.string(),
  /** Where opening it should take you. Null means nowhere in particular. */
  link: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationItem = z.infer<typeof notificationItem>;

export const notificationsResponse = z.object({
  notifications: z.array(notificationItem),
  unreadCount: z.number().int().nonnegative(),
});
export type NotificationsResponse = z.infer<typeof notificationsResponse>;
