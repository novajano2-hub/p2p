import { Reveal } from "@/components/motion/reveal";
import { Section, SectionHeading } from "@/components/marketing/section";

/*
  The copy here is constrained by ADR-0006: never promise a free withdrawal
  until the full route is validated. "No platform fee" is the only claim made.
*/
const rows = [
  {
    term: "Trading",
    value: "No platform fee.",
    note: "Trades move USDT between balances inside the platform, so there is no network cost either.",
  },
  {
    term: "Deposits",
    value: "No platform fee.",
    note: "The wallet or exchange you send from may charge its own fee.",
  },
  {
    term: "Withdrawals",
    value: "No platform fee.",
    note: "The network or a third party may charge a fee. The exact amount is shown before you confirm.",
  },
] as const;

export function Fees() {
  return (
    <Section id="fees" aria-labelledby="fees-title">
      <Reveal>
        <SectionHeading
          id="fees-title"
          title="No platform fee on trades. No hidden spread."
          lede="The rate you see in an offer is the rate you pay. What the platform charges is written down here, in full."
        />
      </Reveal>

      <Reveal delay={0.1}>
        <dl className="divide-border rounded-panel border-border bg-surface shadow-panel mt-12 grid divide-y border lg:mt-16 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          {rows.map((row) => (
            <div key={row.term} className="px-6 py-7 sm:px-8 sm:py-8">
              <dt className="text-muted-foreground text-sm font-medium">{row.term}</dt>
              <dd>
                <p className="mt-2 text-2xl font-semibold tracking-tight">{row.value}</p>
                <p className="text-muted-foreground mt-3 max-w-prose text-[15px] leading-relaxed text-pretty">
                  {row.note}
                </p>
              </dd>
            </div>
          ))}
        </dl>
      </Reveal>
    </Section>
  );
}
