import { Panel } from "@/components/app/panel";
import { ButtonLink } from "@/components/ui/button";

/*
  The balance card. Three figures a customer needs at a glance: what they can
  trade with now, what is locked in escrow for trades in progress, and roughly
  what that is worth in birr. The ledger that fills these in is Phase 2; until
  then a new account's true balance is zero, and the card says so rather than
  inventing a number.
*/

const stats = [
  { label: "Available", value: "0.00", unit: "USDT" },
  { label: "In escrow", value: "0.00", unit: "USDT" },
  { label: "Estimated value", value: "—", unit: "ETB" },
] as const;

export function WalletCard({ className }: { className?: string | undefined }) {
  return (
    <Panel className={className}>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-muted-foreground text-[13px] font-medium">Total balance</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-foreground font-mono text-4xl font-medium tracking-tight tabular-nums">
              0.00
            </span>
            <span className="text-muted-foreground text-base font-medium">USDT</span>
          </p>
        </div>
        <div className="flex gap-2">
          <ButtonLink href="/wallet" arrow={false}>
            Deposit
          </ButtonLink>
          <ButtonLink href="/wallet" variant="secondary" arrow={false}>
            Withdraw
          </ButtonLink>
        </div>
      </div>

      <dl className="border-border mt-6 grid grid-cols-3 gap-4 border-t pt-5">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt className="text-muted-foreground text-[12px]">{stat.label}</dt>
            <dd className="mt-1 flex items-baseline gap-1">
              <span className="text-foreground font-mono text-lg font-medium tabular-nums">
                {stat.value}
              </span>
              <span className="text-muted-foreground text-[12px]">{stat.unit}</span>
            </dd>
          </div>
        ))}
      </dl>

      <p className="text-muted-foreground mt-4 text-[12px] leading-relaxed">
        Deposits and withdrawals open once custody is connected. Nothing can be moved yet.
      </p>
    </Panel>
  );
}
