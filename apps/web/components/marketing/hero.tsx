"use client";

import { useRef } from "react";

import { Container } from "@/components/marketing/section";
import { MOTION_OK, SplitText, ease, gsap, useGSAP } from "@/components/motion/gsap";
import { HeroVisual } from "@/components/three/hero-visual";
import { ButtonLink } from "@/components/ui/button";
import { cta, site } from "@/lib/site";

/*
  Entrance, once, on first paint. The headline rises word by word (hierarchy:
  the sentence lands first), then the explanation and the actions follow, then
  the vault fades up beside them. Under reduced motion the block is simply there.
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

        const split = SplitText.create(headline, { type: "words" });
        const tl = gsap.timeline({ defaults: { ease: ease.out } });
        tl.from(split.words, { y: 22, opacity: 0, duration: 0.85, stagger: 0.028 })
          .from(
            fades,
            { y: 12, opacity: 0, duration: 0.65, stagger: 0.1, ease: ease.soft },
            "-=0.5",
          )
          .from(
            visual,
            { opacity: 0, scale: 0.97, duration: 1, ease: ease.soft, transformOrigin: "50% 60%" },
            "-=0.85",
          );

        return () => split.revert();
      });
    },
    { scope: root },
  );

  return (
    <div ref={root} className="hero-surface border-border/70 border-b">
      <Container className="pt-14 pb-16 sm:pt-18 lg:pt-20 lg:pb-24">
        <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-7">
            <h1
              data-hero-headline
              className="font-display text-foreground max-w-[19ch] text-[2.125rem] leading-[1.08] text-balance sm:text-[2.75rem] lg:text-[3.25rem]"
            >
              {site.tagline}
            </h1>
            <p
              data-hero-fade
              className="text-muted-foreground mt-5 max-w-[46ch] text-base leading-relaxed text-pretty sm:text-[17px]"
            >
              The USDT is locked the moment a trade starts and released only when you confirm the
              birr arrived. Nobody has to trust a stranger.
            </p>
            <div
              data-hero-fade
              className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6"
            >
              <ButtonLink href={cta.signup.href} size="lg" className="group/btn">
                {cta.signup.label}
              </ButtonLink>
              <ButtonLink href={cta.learn.href} variant="ghost" className="group/btn">
                {cta.learn.label}
              </ButtonLink>
            </div>
          </div>

          {/* The 3D vault is a desktop-only flourish. It never mounts below lg. */}
          <div className="hidden lg:col-span-5 lg:block">
            <HeroVisual />
          </div>
        </div>
      </Container>
    </div>
  );
}
