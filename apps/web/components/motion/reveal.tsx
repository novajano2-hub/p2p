"use client";

import { useRef, type ReactNode } from "react";

import { MOTION_OK, ease, gsap, useGSAP } from "@/components/motion/gsap";

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Seconds. Small multiples (0.06) stagger siblings. */
  delay?: number;
};

/*
  Scroll reveal: a 22px rise and fade, once, as the element enters the lower
  part of the viewport. Purpose: hierarchy, content arrives in reading order.
  Under reduced motion the matchMedia block never runs and nothing moves.
*/
export function Reveal({ children, className, delay = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        // opacity, never visibility: hidden elements leave the accessibility
        // tree and cannot take keyboard focus before they scroll into view.
        gsap.from(ref.current, {
          y: 22,
          opacity: 0,
          duration: 0.9,
          delay,
          ease: ease.soft,
          scrollTrigger: { trigger: ref.current, start: "top 88%", once: true },
        });
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
