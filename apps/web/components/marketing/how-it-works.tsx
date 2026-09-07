"use client";

import { useRef } from "react";

import { LEDGER_STATES, LedgerCard } from "@/components/marketing/ledger-card";
import { Container } from "@/components/marketing/section";
import { MOTION_OK, ease, gsap, useGSAP } from "@/components/motion/gsap";
import { cn } from "@/lib/cn";
import { useMediaQuery } from "@/lib/use-media-query";

/*
  The scroll narrative. On a desktop that allows motion, this section pins
  and scrolling scrubs through the four steps of a trade while the ledger
  card beside them moves the money for real: 250 USDT leaves the seller's
  available balance, sits in escrow, and lands with the buyer. Purpose:
  storytelling, in the sequence a trade actually happens.

  Everywhere else (small screens, reduced motion) the steps stack and the
  ledger shows the finished trade. Same content, no pin, no scrub.
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

const NARRATIVE_QUERY = `${MOTION_OK} and (min-width: 1024px)`;

export function HowItWorks() {
  const root = useRef<HTMLElement>(null);
  const live = useMediaQuery(NARRATIVE_QUERY);

  useGSAP(
    () => {
      if (!live) return;
      const scope = root.current;
      if (!scope) return;

      const stage = scope.querySelector<HTMLElement>("[data-stage]");
      const items = gsap.utils.toArray<HTMLElement>("[data-step]", scope);
      const rules = gsap.utils.toArray<HTMLElement>("[data-step-rule]", scope);
      const pills = gsap.utils.toArray<HTMLElement>("[data-ledger-status]", scope);
      const amountEl = (account: string) =>
        scope.querySelector<HTMLElement>(`[data-ledger-row="${account}"] [data-amount]`);
      if (!stage || items.length !== steps.length) return;

      const money = { seller: 250, escrow: 0, buyer: 0 };
      const paint = () => {
        for (const [account, value] of Object.entries(money)) {
          const el = amountEl(account);
          if (el) el.textContent = value.toFixed(2);
        }
      };

      const tl = gsap.timeline({
        defaults: { ease: ease.inOut },
        scrollTrigger: {
          trigger: scope,
          start: "top top",
          end: `+=${steps.length * 85}%`,
          pin: stage,
          scrub: 0.6,
          snap: { snapTo: 1 / (steps.length - 1), duration: 0.35, ease: "power1.inOut" },
        },
      });

      steps.forEach((_, i) => {
        const at = i;
        tl.to(items, { opacity: (index: number) => (index === i ? 1 : 0.38), duration: 0.6 }, at);
        tl.to(rules, { scaleY: (index: number) => (index === i ? 1 : 0), duration: 0.6 }, at);
        tl.to(pills, { autoAlpha: (index: number) => (index === i ? 1 : 0), duration: 0.4 }, at);

        if (i === 1) {
          tl.to(money, { seller: 0, escrow: 250, duration: 0.7, onUpdate: paint }, at + 0.15);
        }
        if (i === 3) {
          tl.to(money, { escrow: 0, buyer: 250, duration: 0.7, onUpdate: paint }, at + 0.15);
        }
      });
    },
    { scope: root, dependencies: [live] },
  );

  return (
    <section ref={root} id="how-it-works" aria-labelledby="how-it-works-title">
      <div data-stage className={cn(live && "flex min-h-screen items-center")}>
        {/* While pinned the stage must fit one viewport, so vertical padding shrinks. */}
        <Container className={cn("py-20 sm:py-24", live ? "lg:py-10" : "lg:py-28")}>
          <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-6">
              <h2
                id="how-it-works-title"
                className="font-display text-foreground text-4xl leading-[1.08] text-balance sm:text-5xl lg:text-[3.4rem]"
              >
                How a trade works.
              </h2>

              <ol className="border-border mt-12 border-t">
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
                      style={{ transform: live ? "scaleY(0)" : "scaleY(1)" }}
                    />
                    <h3 className="font-display text-foreground text-2xl leading-tight sm:text-[1.75rem]">
                      {step.title}
                    </h3>
                    <p className="text-muted-foreground mt-2 max-w-prose text-[15px] leading-relaxed text-pretty">
                      {step.body}
                    </p>
                  </li>
                ))}
              </ol>

              <p className="text-muted-foreground mt-8 max-w-prose text-[15px] leading-relaxed">
                If the two of you disagree, either side can open a dispute. The USDT stays locked
                while a reviewer looks at the evidence from both sides.
              </p>
            </div>

            <div className="lg:col-span-6 lg:pt-14">
              <LedgerCard mode={live ? "live" : "final"} />
              <p className="sr-only">{LEDGER_STATES.map((state) => state.label).join(". ")}.</p>
            </div>
          </div>
        </Container>
      </div>
    </section>
  );
}
