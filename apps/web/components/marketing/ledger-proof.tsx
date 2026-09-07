import { Reveal } from "@/components/motion/reveal";
import { Section, SectionHeading } from "@/components/marketing/section";
import { StatusPill } from "@/components/ui/status-pill";

/*
  Two real journal entries from the platform's ledger design (JE-3 and JE-4 in
  docs/architecture/ledger-taxonomy.md), typeset like a receipt. This is what
  actually happens when a trade locks and releases. Showing it is the point:
  the escrow is bookkeeping you can audit, not a promise.
*/

const principles = [
  {
    title: "Escrow, not promises",
    body: "The USDT is moved out of the seller's balance before the buyer pays a single birr, and moved to the buyer only when the seller confirms the money arrived.",
  },
  {
    title: "Your own deposit address",
    body: "Every account gets a unique USDT address, so a deposit is always matched to you and never to someone else.",
  },
  {
    title: "Disputes are read by a person",
    body: "If a trade goes wrong, the USDT stays locked while a reviewer looks at the evidence from both sides. Every decision is recorded.",
  },
  {
    title: "A second confirmation before money moves",
    body: "Withdrawals and escrow release ask you to confirm again, even when you are already logged in.",
  },
] as const;

export function LedgerProof() {
  return (
    <Section id="safety" aria-labelledby="safety-title">
      <Reveal>
        <SectionHeading
          id="safety-title"
          title="Every trade is a balanced entry."
          lede="Where your money sits is written down twice, on every move. Here is a real trade, exactly as the ledger records it."
        />
      </Reveal>

      <div className="mt-14 grid gap-12 lg:mt-16 lg:grid-cols-12 lg:gap-16">
        <Reveal className="lg:col-span-6">
          <Receipt />
        </Reveal>

        <div className="lg:col-span-6">
          <dl className="divide-border border-border divide-y border-t">
            {principles.map((item, i) => (
              <Reveal key={item.title} delay={i * 0.06} className="py-6 first:pt-0">
                <dt className="font-display text-foreground text-2xl leading-tight">
                  {item.title}
                </dt>
                <dd className="text-muted-foreground mt-2 max-w-prose text-[15px] leading-relaxed text-pretty">
                  {item.body}
                </dd>
              </Reveal>
            ))}
          </dl>
        </div>
      </div>
    </Section>
  );
}

function Receipt() {
  return (
    <div className="rounded-surface border-border bg-surface shadow-panel border">
      <Entry
        title="Escrow locked"
        reference="Trade T-0142"
        lines={[
          { side: "Dr", account: "Selam, available", amount: "250.00" },
          { side: "Cr", account: "Trade T-0142, escrow", amount: "250.00" },
        ]}
        pill={<StatusPill status="pending">Locked</StatusPill>}
      />
      <Entry
        title="Escrow released"
        reference="Selam confirmed birr received"
        lines={[
          { side: "Dr", account: "Trade T-0142, escrow", amount: "250.00" },
          { side: "Cr", account: "Dawit, available", amount: "250.00" },
          { side: "Cr", account: "Platform, trade fee", amount: "0.00" },
        ]}
        pill={<StatusPill status="complete">Complete</StatusPill>}
      />
      <p className="text-muted-foreground px-5 py-3 text-xs">
        Dr and Cr are the two sides of every entry. They always add up to the same number, which is
        how the system knows nothing was lost or invented.
      </p>
    </div>
  );
}

type Line = { side: "Dr" | "Cr"; account: string; amount: string };

function Entry({
  title,
  reference,
  lines,
  pill,
}: {
  title: string;
  reference: string;
  lines: Line[];
  pill: React.ReactNode;
}) {
  return (
    <div className="border-border border-b px-5 py-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-display text-xl leading-none">{title}</p>
          <p className="text-muted-foreground mt-1 text-[13px]">{reference}</p>
        </div>
        {pill}
      </div>
      <table className="mt-4 w-full font-mono text-[14px] tabular-nums">
        <tbody>
          {lines.map((line) => (
            <tr key={line.side + line.account} className="align-baseline">
              <td className="text-muted-foreground w-8 py-1">{line.side}</td>
              <td className="text-foreground py-1 pr-4">{line.account}</td>
              <td className="text-foreground py-1 text-right">{line.amount}</td>
            </tr>
          ))}
          <tr className="border-border border-t">
            <td className="text-muted-foreground pt-2" colSpan={2}>
              Balanced
            </td>
            <td className="text-primary pt-2 text-right">
              {lines
                .filter((l) => l.side === "Dr")
                .reduce((s, l) => s + Number(l.amount), 0)
                .toFixed(2)}{" "}
              ={" "}
              {lines
                .filter((l) => l.side === "Cr")
                .reduce((s, l) => s + Number(l.amount), 0)
                .toFixed(2)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
