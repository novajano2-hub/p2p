import { Panel } from "@/components/app/panel";
import { AppLink } from "@/components/ui/app-link";

/*
  The best price on each side of the market right now, which is the one number
  most customers open the app to check. Offers arrive with the marketplace in
  Phase 2; until then both sides say so honestly.
*/

const sides = [
  { label: "Buy USDT", hint: "lowest ask" },
  { label: "Sell USDT", hint: "highest bid" },
] as const;

export function MarketSnapshot({ className }: { className?: string | undefined }) {
  return (
    <Panel
      title="Market"
      description="Best offers right now, in birr per USDT."
      action={
        <AppLink
          href="/trade"
          className="text-primary hover:text-primary-hover font-medium underline-offset-4 hover:underline"
        >
          All offers
        </AppLink>
      }
      className={className}
    >
      <dl className="divide-border divide-y">
        {sides.map((side) => (
          <div key={side.label} className="flex items-center justify-between gap-4 py-3">
            <dt>
              <span className="text-foreground block text-sm font-medium">{side.label}</span>
              <span className="text-muted-foreground block text-[12px]">{side.hint}</span>
            </dt>
            <dd className="text-right">
              <span className="text-foreground block font-mono text-lg font-medium tabular-nums">
                —
              </span>
              <span className="text-muted-foreground block text-[12px]">No offers yet</span>
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
