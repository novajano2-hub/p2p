/*
  Whether the big KYC card on /account has already been dismissed for the
  account's CURRENT status.

  One stored value, not a set of them: the card is a one-time nudge about
  whatever is true right now, not a history of every status ever seen. Storing
  only the status last dismissed is what makes a genuine status change show
  the card again automatically - the stored value simply stops matching - with
  no separate "mark unseen" step needed anywhere a status is changed.

  Dismissing does not hide the account's status from the customer: the small
  pill next to their name (components/account/kyc-card.tsx, KycPill) stays up
  regardless and is the way back to /verify after the card is gone.
*/

const STORAGE_KEY = "birq.kyc-notice-dismissed";

export function readDismissedKycStatus(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function dismissKycStatus(status: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, status);
  } catch {
    // Private mode or storage disabled: the dismissal still applies to this
    // render, it just will not survive a reload.
  }
}
