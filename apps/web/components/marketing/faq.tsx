import { CaretDown } from "@phosphor-icons/react/dist/ssr";

import { Reveal } from "@/components/motion/reveal";
import { Section, SectionHeading } from "@/components/marketing/section";
import { site } from "@/lib/site";

const items = [
  {
    q: "Do I need a crypto wallet?",
    a: `No. ${site.name} gives you a USDT deposit address and holds the funds for you. You never handle keys or seed phrases.`,
  },
  {
    q: "How do I pay the birr?",
    a: `Directly to the seller, by bank transfer or mobile money, using the instructions shown inside the trade. ${site.name} never touches your birr.`,
  },
  {
    q: "What if the seller refuses to release?",
    a: "Their USDT stays locked in escrow. Open a dispute, and a reviewer decides based on the evidence both of you provide.",
  },
  {
    q: "Are there any fees?",
    a: "No platform fee on trades. Sending USDT in or out may involve a network or third-party fee, and you see it before confirming.",
  },
  {
    q: "Which network do deposits use?",
    a: "One network at launch, shown on your deposit page together with your address. Always check the network before sending; funds sent on the wrong one may not be recoverable.",
  },
] as const;

export function Faq() {
  return (
    <Section id="faq" aria-labelledby="faq-title" className="border-border border-t">
      <Reveal>
        <SectionHeading id="faq-title" title="Questions." />
      </Reveal>

      <Reveal delay={0.08}>
        <div className="divide-border border-border mt-12 divide-y border-t border-b lg:mt-14">
          {items.map((item) => (
            <details key={item.q} className="faq-item group">
              <summary className="font-display text-foreground flex items-center justify-between gap-6 py-6 text-left text-2xl leading-tight">
                <span>{item.q}</span>
                <CaretDown
                  size={20}
                  aria-hidden="true"
                  className="faq-chevron text-muted-foreground shrink-0"
                />
              </summary>
              <p className="text-muted-foreground max-w-[64ch] pb-7 text-[15px] leading-relaxed text-pretty">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </Reveal>
    </Section>
  );
}
