"use client";

import { useEffect, useRef } from "react";

/*
  What a screen shows is as old as the last time it asked. Most of it says so
  by changing - a status, a message - and the live connection tells the screen
  to look. Whether somebody is around does not: nobody is told when a stranger
  closes their browser, so a list left open went on showing them "Online" for
  as long as it stayed open.

  So a screen that shows who is around asks again every so often, quietly: no
  "Loading", nothing moved, and a refresh that fails changes nothing. Only
  while the tab is being looked at and the browser is online - and at once on
  coming back to a tab that was away for longer than the interval.
*/
export function useQuietRefresh(refresh: () => void, everyMs = 30_000): void {
  // Read through a ref: callers pass a fresh closure on every render.
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });

  useEffect(() => {
    let last = Date.now();
    const run = () => {
      last = Date.now();
      latest.current();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) run();
    }, everyMs);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last >= everyMs) run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [everyMs]);
}
