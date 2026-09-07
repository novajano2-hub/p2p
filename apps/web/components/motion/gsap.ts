import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

/*
  Single registration point for GSAP. Client components import from here so
  plugins are registered exactly once and never on the server.

  GSAP is the only DOM animation library in this app. Three.js (via
  react-three-fiber) owns the canvas. They never share a component tree.
*/
if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);
}

/** Every motion here is gated on this query. Under "reduce", nothing moves. */
export const MOTION_OK = "(prefers-reduced-motion: no-preference)";

export const ease = {
  out: "power4.out",
  soft: "power3.out",
  inOut: "power2.inOut",
} as const;

export { gsap, ScrollTrigger, SplitText, useGSAP };
