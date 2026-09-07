import type { Icon } from "@phosphor-icons/react";
import { Bank, Handshake, LockKeyOpen, Wallet } from "@phosphor-icons/react/dist/ssr";

import { Reveal } from "@/components/motion/reveal";
import { Section, SectionHeading } from "@/components/marketing/section";

type Step = { title: string; body: string; Icon: Icon };

const steps: Step[] = [
  {
    title: "Deposit USDT",
    body: "Send USDT to your own deposit address. It shows in your balance once the network confirms it.",
    Icon: Wallet,
  },
  {
    title: "Accept an offer",
    body: "Pick a rate and amount. The seller's USDT is locked in escrow the moment you accept.",
    Icon: Handshake,
  },
  {
    title: "Pay in birr",
    body: "Send birr straight to the seller by bank transfer or mobile money, then mark the trade paid.",
    Icon: Bank,
  },
  {
    title: "USDT released",
    body: "The seller confirms the birr arrived, and the USDT moves from escrow to your balance.",
    Icon: LockKeyOpen,
  },
];

export function HowItWorks() {
  return (
    <Section id="how-it-works" aria-labelledby="how-it-works-title">
      <Reveal>
        <SectionHeading
          id="how-it-works-title"
          title="How a trade works"
          lede="Four steps. The USDT never leaves escrow until the person selling it says the birr has arrived."
        />
      </Reveal>

      <ol className="mt-14 grid gap-10 lg:mt-16 lg:grid-cols-4 lg:gap-8">
        {steps.map((step, i) => (
          <li key={step.title} className="relative">
            <Reveal delay={i * 0.07}>
              <div className="flex items-center gap-4 lg:block">
                <span className="rounded-control bg-primary-soft text-primary-soft-foreground flex size-12 shrink-0 items-center justify-center">
                  <step.Icon size={24} aria-hidden="true" />
                </span>
                <span
                  aria-hidden="true"
                  className="bg-border hidden h-px flex-1 lg:absolute lg:top-6 lg:right-0 lg:left-16 lg:block"
                />
              </div>
              <h3 className="mt-5 text-lg font-semibold tracking-tight">{step.title}</h3>
              <p className="text-muted-foreground mt-2 text-[15px] leading-relaxed text-pretty">
                {step.body}
              </p>
            </Reveal>
          </li>
        ))}
      </ol>

      <Reveal delay={0.3}>
        <p className="text-muted-foreground mt-12 max-w-2xl text-[15px] leading-relaxed lg:mt-16">
          If the two of you disagree, either side can open a dispute. The USDT stays locked while a
          reviewer looks at the evidence from both sides, and only then does it move.
        </p>
      </Reveal>
    </Section>
  );
}
