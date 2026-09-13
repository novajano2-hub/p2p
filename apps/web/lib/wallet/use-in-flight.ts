import { useEffect } from "react";

/*
  Re-read while something is still moving, and stop as soon as nothing is.

  A deposit confirming and a withdrawal being sent both settle on their own,
  without anything happening in this tab, so a screen that only loads once
  leaves a person staring at a stale row and pressing Refresh. Polling is the
  honest answer here: there is no push channel, and the alternative is an
  interface that is wrong more often than it is right.

  It only runs while there is something in flight, so an idle wallet makes no
  requests at all, and it stops while the tab is hidden - a phone in a pocket
  should not be asking every fifteen seconds.
*/

const INTERVAL_MS = 15_000;

export function useInFlight(active: boolean, reload: () => void): void {
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (document.visibilityState === "visible") reload();
    };
    const timer = window.setInterval(tick, INTERVAL_MS);
    // A tab coming back after a while is the moment the screen is most likely
    // to be stale, so it is also a moment to re-read.
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [active, reload]);
}
