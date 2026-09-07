import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { cn } from "@/lib/cn";

/*
  A trade, as the ledger sees it: three accounts and where the USDT sits.
  As the steps scroll past, GSAP drives the amounts and the status pill by
  targeting the data attributes below. This component holds no state, so React
  never fights the animation for those nodes.
*/

export const LEDGER_STATES = [
  { key: "deposited", status: "neutral", label: "Awaiting an offer" },
  { key: "locked", status: "pending", label: "In escrow" },
  { key: "paid", status: "pending", label: "Birr sent" },
  { key: "released", status: "complete", label: "Released" },
] as const satisfies ReadonlyArray<{ key: string; status: StatusTone; label: string }>;

export type LedgerStateKey = (typeof LEDGER_STATES)[number]["key"];

type Amounts = { seller: string; escrow: string; buyer: string };

const initial: Amounts = { seller: "250.00", escrow: "0.00", buyer: "0.00" };
const released: Amounts = { seller: "0.00", escrow: "0.00", buyer: "250.00" };

type LedgerCardProps = {
  /** "live" renders every status pill for GSAP to toggle; "final" renders the end state only. */
  mode: "live" | "final";
  className?: string;
};

export function LedgerCard({ mode, className }: LedgerCardProps) {
  const amounts = mode === "final" ? released : initial;
  const visible: LedgerStateKey = mode === "final" ? "released" : "deposited";

  return (
    <div
      data-ledger-card
      className={cn("border-border bg-surface/70 rounded-surface border", className)}
    >
      <div className="border-border flex items-center justify-between gap-4 border-b px-5 py-3.5">
        <p className="text-muted-foreground text-[13px]">250 USDT for 39,600 ETB</p>
        <div className="relative h-7 min-w-[8.5rem]">
          {LEDGER_STATES.map((state) =>
            mode === "final" && state.key !== "released" ? null : (
              <StatusPill
                key={state.key}
                status={state.status}
                data-ledger-status={state.key}
                className="absolute top-0 right-0"
                style={{ opacity: state.key === visible ? 1 : 0 }}
              >
                {state.label}
              </StatusPill>
            ),
          )}
        </div>
      </div>

      <dl className="divide-border divide-y">
        <Row account="seller" label="Seller, available" amount={amounts.seller} />
        <Row account="escrow" label="Trade escrow" amount={amounts.escrow} emphasis />
        <Row account="buyer" label="Buyer, available" amount={amounts.buyer} />
      </dl>
    </div>
  );
}

function Row({
  account,
  label,
  amount,
  emphasis = false,
}: {
  account: keyof Amounts;
  label: string;
  amount: string;
  emphasis?: boolean;
}) {
  return (
    <div
      data-ledger-row={account}
      className={cn(
        "flex items-baseline justify-between gap-6 px-5 py-4",
        emphasis && "bg-primary-soft/35",
      )}
    >
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-foreground font-mono text-base tabular-nums">
        <span data-amount>{amount}</span>
        <span className="text-muted-foreground ml-1.5 text-xs">USDT</span>
      </dd>
    </div>
  );
}
