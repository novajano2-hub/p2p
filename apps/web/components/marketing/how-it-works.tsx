"use client";

import { useRef } from "react";

import { LEDGER_STATES, LedgerCard } from "@/components/marketing/ledger-card";
import { Container } from "@/components/marketing/section";
import { MOTION_OK, ScrollTrigger, ease, gsap, useGSAP } from "@/components/motion/gsap";
import { useMediaQuery } from "@/lib/use-media-query";

/*
  Four steps, scrolled through at the reader's own pace. Nothing is pinned and
  nothing is scrubbed: the page scrolls normally, the ledger card sits sticky
  beside the steps on desktop, and each step lights up as it reaches the middle
  of the viewport, moving the money in the card with it.

  Purpose: storytelling in the sequence a trade actually happens, without
  taking the scrollbar away from the reader.
*/

const steps = [
  {
    title: "Deposit USDT",
    body: "Send USDT to your own deposit address. It appears in your balance once the network confirms it.",
  },
  {
    title: "Accept an offer",
    body: "Choose a rate. The seller's USDT moves out of their balance and into escrow the moment you accept.",
  },
  {
    title: "Pay the seller in birr",
    body: "Bank transfer or mobile money, straight to them. Then mark the trade as paid.",
  },
  {
    title: "USDT is released",
    body: "The seller confirms the birr arrived. Escrow releases the USDT into your balance.",
  },
] as const;

/** Where the money sits at each step. */
const balances = [
  { seller: 250, escrow: 0, buyer: 0 },
  { seller: 0, escrow: 250, buyer: 0 },
  { seller: 0, escrow: 250, buyer: 0 },
  { seller: 0, escrow: 0, buyer: 250 },
] as const;

export function HowItWorks() {
  const root = useRef<HTMLElement>(null);
  const motionOk = useMediaQuery(MOTION_OK);

  useGSAP(
    () => {
      if (!motionOk) return;
      const scope = root.current;
      if (!scope) return;

      const items = gsap.utils.toArray<HTMLElement>("[data-step]", scope);
      const rules = gsap.utils.toArray<HTMLElement>("[data-step-rule]", scope);
      const pills = gsap.utils.toArray<HTMLElement>("[data-ledger-status]", scope);
      if (items.length !== steps.length) return;

      const money = { ...balances[0] };
      const paint = () => {
        for (const [account, value] of Object.entries(money)) {
          const el = scope.querySelector<HTMLElement>(
            `[data-ledger-row="${account}"] [data-amount]`,
          );
          if (el) el.textContent = value.toFixed(2);
        }
      };

      let current = -1;
      const show = (index: number) => {
        if (index === current) return;
        current = index;
        gsap.to(items, {
          opacity: (i: number) => (i === index ? 1 : 0.45),
          duration: 0.4,
          ease: ease.soft,
        });
        gsap.to(rules, {
          scaleY: (i: number) => (i === index ? 1 : 0),
          duration: 0.4,
          ease: ease.soft,
        });
        gsap.to(pills, {
          autoAlpha: (i: number) => (i === index ? 1 : 0),
          duration: 0.3,
        });
        gsap.to(money, {
          ...balances[index],
          duration: 0.55,
          ease: ease.inOut,
          onUpdate: paint,
        });
      };

      items.forEach((item, index) => {
        ScrollTrigger.create({
          trigger: item,
          start: "top 68%",
          end: "bottom 42%",
          onEnter: () => show(index),
          onEnterBack: () => show(index),
        });
      });

      show(0);
    },
    { scope: root, dependencies: [motionOk] },
  );

  return (
    <section ref={root} id="how-it-works" aria-labelledby="how-it-works-title">
      <Container className="py-18 sm:py-20 lg:py-24">
        <h2
          id="how-it-works-title"
          className="font-display text-foreground text-2xl leading-[1.15] text-balance sm:text-3xl lg:text-[2.125rem]"
        >
          How a trade works.
        </h2>

        <div className="mt-10 grid items-start gap-10 lg:mt-14 lg:grid-cols-12 lg:gap-14">
          <ol className="border-border border-t lg:col-span-7">
            {steps.map((step) => (
              <li
                key={step.title}
                data-step
                className="border-border relative border-b py-6 pl-6 lg:py-7"
              >
                <span
                  data-step-rule
                  aria-hidden="true"
                  className="bg-primary absolute top-6 bottom-6 left-0 w-0.5 origin-top lg:top-7 lg:bottom-7"
                  style={{ transform: motionOk ? "scaleY(0)" : "scaleY(1)" }}
                />
                <h3 className="font-display text-foreground text-lg leading-snug sm:text-xl">
                  {step.title}
                </h3>
                <p className="text-muted-foreground mt-1.5 max-w-prose text-[15px] leading-relaxed text-pretty">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>

          {/*
            The card only earns its place when it can sit beside the steps it
            annotates. Stacked under them on a narrow screen it is just a second
            copy of the same story, so below lg it is not rendered at all.
          */}
          <div className="hidden lg:sticky lg:top-24 lg:col-span-5 lg:block">
            <LedgerCard mode={motionOk ? "live" : "final"} />
            <p className="sr-only">{LEDGER_STATES.map((state) => state.label).join(". ")}.</p>
          </div>
        </div>

        <p className="text-muted-foreground mt-10 max-w-prose text-[15px] leading-relaxed">
          If the two of you disagree, either side can open a dispute. The USDT stays locked while a
          reviewer looks at the evidence from both sides.
        </p>
      </Container>
    </section>
  );
}
