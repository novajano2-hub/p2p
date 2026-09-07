"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";

import { SceneErrorBoundary } from "@/components/three/scene-error-boundary";
import { cn } from "@/lib/cn";
import { useDelayedTrue, useIsClient, useLowPower, useMediaQuery } from "@/lib/use-media-query";

/*
  three.js is loaded only in the browser, only after first paint, and only
  once we know the viewer's motion preference and rough device class. Until
  then, and whenever WebGL is unavailable, the still backdrop stands in.
*/
const EscrowScene = dynamic(() => import("@/components/three/escrow-scene"), {
  ssr: false,
  loading: () => null,
});

// Motion preference and device class come from lib/use-media-query, hydration-safe.

export function HeroVisual({ className }: { className?: string }) {
  const ready = useIsClient();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const lowPower = useLowPower();
  // Mount the scene after the headline entrance so the chunk parse never stutters it.
  const settled = useDelayedTrue(reduced ? 0 : 1400);

  return (
    <div
      data-hero-visual
      data-state={ready ? "ready" : "loading"}
      aria-hidden="true"
      className={cn("relative aspect-square w-full", className)}
    >
      <Backdrop />
      {ready && settled ? (
        <div className="absolute inset-0 transition-opacity duration-700 ease-out motion-reduce:transition-none starting:opacity-0">
          <SceneErrorBoundary fallback={<StillCoin />}>
            <Suspense fallback={null}>
              <EscrowScene reduced={reduced} lowPower={lowPower} />
            </Suspense>
          </SceneErrorBoundary>
        </div>
      ) : null}
    </div>
  );
}

/** Soft sage floor the scene sits on. Always present, under the canvas. */
function Backdrop() {
  return (
    <div className="rounded-surface absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_62%,color-mix(in_oklab,var(--color-sage)_38%,transparent),transparent_72%)]" />
  );
}

/** Static stand-in when WebGL is unavailable: the coin, held. */
function StillCoin() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="border-border bg-surface/70 shadow-panel flex size-[46%] items-center justify-center rounded-[22%] border">
        <div className="bg-primary ring-sage/70 size-[42%] rounded-full ring-4" />
      </div>
    </div>
  );
}
