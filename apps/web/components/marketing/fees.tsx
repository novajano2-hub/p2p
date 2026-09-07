import { Reveal } from "@/components/motion/reveal";
import { Section, SectionHeading } from "@/components/marketing/section";

/*
  Copy is constrained by ADR-0006: never promise a free withdrawal until the
  full route is validated. "No platform fee" is the only claim made.
*/
const rates = [
  {
    term: "Trading",
    figure: "0%",
    note: "No platform fee. Trades move USDT between balances inside the platform, so there is no network cost either.",
  },
  {
    term: "Deposits",
    figure: "0",
    note: "No platform fee. The wallet or exchange you send from may charge its own.",
  },
  {
    term: "Withdrawals",
    figure: "0",
    note: "No platform fee. The network or a third party may charge one, and you see it before you confirm.",
  },
] as const;

export function Fees() {
  return (
    <Section id="fees" aria-labelledby="fees-title" className="border-border border-t">
      <Reveal>
        <SectionHeading
          id="fees-title"
          title="What it costs."
          lede="The rate you see in an offer is the rate you pay. This is the entire price list."
        />
      </Reveal>

      <Reveal delay={0.08}>
        <dl className="border-border mt-12 grid border-t lg:mt-14 lg:grid-cols-3">
          {rates.map((rate) => (
            <div
              key={rate.term}
              className="border-border border-b py-7 lg:border-r lg:px-7 lg:py-8 lg:first:pl-0 lg:last:border-r-0"
            >
              <dt className="text-muted-foreground text-sm font-medium">{rate.term}</dt>
              <dd>
                <p className="font-display text-foreground mt-2 text-4xl leading-none tabular-nums">
                  {rate.figure}
                </p>
                <p className="text-muted-foreground mt-3 max-w-[38ch] text-[15px] leading-relaxed text-pretty">
                  {rate.note}
                </p>
              </dd>
            </div>
          ))}
        </dl>
      </Reveal>
    </Section>
  );
}
