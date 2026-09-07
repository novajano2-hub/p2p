"use client";

import { useSyncExternalStore } from "react";

/*
  Media queries and "am I on the client yet" as external stores. The server
  snapshot is always false, so server and first client render agree, and React
  re-renders once with the real value after hydration. No setState in effects.
*/

function subscribeTo(query: string) {
  return (onChange: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  };
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribeTo(query),
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const never = () => () => {};

/** False during SSR and hydration, true once the component is live in the browser. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    never,
    () => true,
    () => false,
  );
}

/** A rough "keep the GPU work light" signal: coarse pointer or few cores. */
export function useLowPower(): boolean {
  const coarse = useMediaQuery("(pointer: coarse)");
  const fewCores = useSyncExternalStore(
    never,
    () => (navigator.hardwareConcurrency ?? 4) <= 4,
    () => false,
  );
  return coarse || fewCores;
}
