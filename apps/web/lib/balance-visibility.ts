/*
  Whether monetary figures are masked, the way an exchange app lets someone
  hide their balance before they screen-share or hand their phone over. One
  preference for the whole app, the same shape as lib/theme.ts: it lives in
  localStorage, applies immediately, and stays in sync across tabs.
*/

const STORAGE_KEY = "birq.balance-hidden";

export function readBalanceHidden(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();

export function setBalanceHidden(hidden: boolean): void {
  try {
    if (hidden) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or storage disabled: the toggle still works for this
    // render, it just will not survive a reload.
  }

  for (const listener of listeners) listener();
}

/** For useSyncExternalStore: a change here, or in another tab, re-renders the control. */
export function subscribeBalanceHidden(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Server and first client render agree: figures show until the real preference loads. */
export const getServerBalanceHidden = (): boolean => false;

/** A fixed-width mask, wide enough that hiding a number never reflows the row it sits in. */
export const MASKED_AMOUNT = "******";
