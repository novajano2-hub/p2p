import { Reveal } from "@/components/motion/reveal";
import { Section, SectionHeading } from "@/components/marketing/section";

/*
  The four rules that make the platform safe to trade on, as a plain numbered
  list rather than a grid of cards. The escrow mechanism is already shown by
  the live ledger in "How a trade works"; this section explains why it holds.
*/

const principles = [
  {
    title: "Escrow, not promises",
    body: "The USDT leaves the seller's balance before the buyer pays a single birr, and reaches the buyer only when the seller confirms the money arrived.",
  },
  {
    title: "Your own deposit address",
    body: "Every account gets a unique USDT address, so a deposit is always matched to you and never to someone else.",
  },
  {
    title: "Disputes are read by a person",
    body: "If a trade goes wrong the USDT stays locked while a reviewer looks at the evidence from both sides. Every decision is recorded.",
  },
  {
    title: "A second confirmation before money moves",
    body: "Withdrawals and escrow release ask you to confirm again, even when you are already logged in.",
  },
] as const;

export function LedgerProof() {
  return (
    <Section id="safety" aria-labelledby="safety-title" className="border-border border-t">
      <Reveal>
        <SectionHeading
          id="safety-title"
          title="Why your money is never in limbo."
          lede="The birr side of a trade happens outside the platform, where nobody can see it. Every rule below exists because of that."
        />
      </Reveal>

      <dl className="mt-12 grid gap-x-14 gap-y-10 sm:grid-cols-2 lg:mt-16">
        {principles.map((item, i) => (
          <Reveal key={item.title} delay={i * 0.06}>
            <dt className="flex items-baseline gap-3">
              <span className="text-muted-foreground font-mono text-[13px] tabular-nums">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="font-display text-foreground text-lg leading-snug sm:text-xl">
                {item.title}
              </span>
            </dt>
            <dd className="text-muted-foreground mt-2 max-w-prose pl-8 text-[15px] leading-relaxed text-pretty">
              {item.body}
            </dd>
          </Reveal>
        ))}
      </dl>
    </Section>
  );
}
