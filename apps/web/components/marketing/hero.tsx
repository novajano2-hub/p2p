"use client";

import { useRef } from "react";

import { Container } from "@/components/marketing/section";
import { MOTION_OK, SplitText, ease, gsap, useGSAP } from "@/components/motion/gsap";
import { HeroVisual } from "@/components/three/hero-visual";
import { ButtonLink } from "@/components/ui/button";
import { cta, site } from "@/lib/site";

/*
  Entrance, once, on first paint. The headline rises word by word out of a
  clip mask (hierarchy: the sentence lands first). The explanation and the
  actions follow, then the vault fades up behind them. Under reduced motion
  the whole block is simply there.
*/
export function Hero() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const scope = root.current;
        if (!scope) return;
        const headline = scope.querySelector<HTMLElement>("[data-hero-headline]");
        const fades = scope.querySelectorAll<HTMLElement>("[data-hero-fade]");
        const visual = scope.querySelector<HTMLElement>("[data-hero-visual]");
        if (!headline) return;

        // Words, not masked lines: masks clip serif descenders and change wrapping.
        const split = SplitText.create(headline, { type: "words" });
        const tl = gsap.timeline({ defaults: { ease: ease.out } });
        tl.from(split.words, { y: 26, opacity: 0, duration: 0.9, stagger: 0.03 })
          .from(
            fades,
            { y: 14, opacity: 0, duration: 0.7, stagger: 0.12, ease: ease.soft },
            "-=0.55",
          )
          .from(
            visual,
            {
              opacity: 0,
              scale: 0.97,
              duration: 1.1,
              ease: ease.soft,
              transformOrigin: "50% 60%",
            },
            "-=0.9",
          );

        return () => split.revert();
      });
    },
    { scope: root },
  );

  return (
    <div ref={root}>
      <Container className="pt-12 pb-16 sm:pt-16 lg:pt-20 lg:pb-24">
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-7">
            <h1
              data-hero-headline
              className="font-display text-foreground max-w-[20ch] text-[2.75rem] leading-[1.04] text-balance sm:text-6xl lg:text-[4rem]"
            >
              {site.tagline}
            </h1>
            <p
              data-hero-fade
              className="text-muted-foreground mt-7 max-w-[44ch] text-lg leading-relaxed text-pretty sm:text-xl"
            >
              The USDT is locked the moment a trade starts and released only when you confirm the
              birr arrived. Nobody has to trust a stranger.
            </p>
            <div
              data-hero-fade
              className="mt-9 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-7"
            >
              <ButtonLink href={cta.signup.href} size="lg">
                {cta.signup.label}
              </ButtonLink>
              <ButtonLink href={cta.learn.href} variant="ghost">
                {cta.learn.label}
              </ButtonLink>
            </div>
          </div>

          <div className="lg:col-span-5">
            <HeroVisual className="mx-auto max-w-[520px] lg:max-w-none" />
          </div>
        </div>
      </Container>
    </div>
  );
}
