"use client";

import { useEffect, useRef } from "react";

import { useOptionalRealtime } from "@/components/app/realtime-provider";
import { noteRetry, retryDelay } from "@/lib/retry-pace";

/*
  Asks again, by itself, for as long as whatever shows a failed load is on the
  screen. Most failures mend without anybody - a server restarting, a deploy,
  a phone between networks - and a screen that waits to be pressed turns each
  of them into a dead end, pressed again and again while the server is still
  on its way back.

  Four things say "now might work": the browser coming back online, the tab
  being looked at again, the live connection returning (the surest sign the
  server is there; absent in the admin realm and before a session exists), and
  a clock that starts quick and slows down the longer it goes on
  (lib/retry-pace.ts). The clock
  holds still while the tab is hidden or the browser offline: nobody is
  looking, or nothing can work.
*/
export function useAutoRetry(onRetry: () => void): void {
  const live = useOptionalRealtime();
  // Read through a ref: callers pass a fresh closure on every render, and a
  // screen that re-renders every second must not push its own retry away.
  const latest = useRef(onRetry);
  useEffect(() => {
    latest.current = onRetry;
  });

  useEffect(() => {
    let timer: number | null = null;
    const again = () => latest.current();

    const tick = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        noteRetry(Date.now());
        again();
      }
      timer = window.setTimeout(tick, retryDelay(Date.now()));
    };
    timer = window.setTimeout(tick, retryDelay(Date.now()));

    const onVisible = () => {
      if (document.visibilityState === "visible") again();
    };
    window.addEventListener("online", again);
    document.addEventListener("visibilitychange", onVisible);
    const stop = live?.on("connected", again);

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("online", again);
      document.removeEventListener("visibilitychange", onVisible);
      stop?.();
    };
  }, [live]);
}
