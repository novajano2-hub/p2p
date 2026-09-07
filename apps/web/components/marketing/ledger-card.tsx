import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { cn } from "@/lib/cn";

/*
  A trade, as the ledger sees it.

  The card is a statement, not a dashboard widget: the amount is set once, at
  size, in the mono face; the three accounts sit under a hairline as a plain
  ledger; and the only colour is the accent rule that marks where the money is
  currently held. As the steps scroll past, GSAP drives the amounts and the
  status pill through the data attributes below. This component holds no state,
  so React never fights the animation for those nodes.
*/

export const LEDGER_STATES = [
  { key: "deposited", status: "neutral", label: "Awaiting an offer" },
  { key: "locked", status: "pending", label: "In escrow" },
  { key: "paid", status: "pending", label: "Birr sent" },
  { key: "released", status: "complete", label: "Released" },
] as const satisfies ReadonlyArray<{ key: string; status: StatusTone; label: string }>;

export type LedgerStateKey = (typeof LEDGER_STATES)[number]["key"];

type Account = "seller" | "escrow" | "buyer";
type Amounts = Record<Account, string>;

const initial: Amounts = { seller: "250.00", escrow: "0.00", buyer: "0.00" };
const released: Amounts = { seller: "0.00", escrow: "0.00", buyer: "250.00" };

const accounts: ReadonlyArray<{ key: Account; label: string }> = [
  { key: "seller", label: "Seller, available" },
  { key: "escrow", label: "Trade escrow" },
  { key: "buyer", label: "Buyer, available" },
];

type LedgerCardProps = {
  /** "live" renders every status pill for GSAP to toggle; "final" renders the end state only. */
  mode: "live" | "final";
  className?: string;
};

export function LedgerCard({ mode, className }: LedgerCardProps) {
  const amounts = mode === "final" ? released : initial;
  const visible: LedgerStateKey = mode === "final" ? "released" : "deposited";

  return (
    <figure
      data-ledger-card
      className={cn(
        "rounded-surface bg-surface shadow-panel ring-border/70 overflow-hidden ring-1",
        className,
      )}
    >
      <div className="px-6 pt-6 pb-5">
        <div className="flex items-start justify-between gap-4">
          <p className="text-muted-foreground text-[13px]">One trade</p>
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

        <p className="text-foreground mt-3 font-mono text-[2rem] leading-none tracking-tight tabular-nums">
          250.00
          <span className="text-muted-foreground ml-2 font-sans text-sm tracking-normal">USDT</span>
        </p>
        <p className="text-muted-foreground mt-2 font-mono text-[13px] tabular-nums">
          39,600.00 <span className="font-sans">ETB</span>
        </p>
      </div>

      <dl className="border-border border-t">
        {accounts.map(({ key, label }) => (
          <div
            key={key}
            data-ledger-row={key}
            className={cn(
              "relative flex items-baseline justify-between gap-6 px-6 py-3.5",
              key !== "buyer" && "border-border/70 border-b",
              key === "escrow" && "bg-primary-soft/30",
            )}
          >
            {key === "escrow" ? (
              <span aria-hidden="true" className="bg-primary absolute inset-y-0 left-0 w-0.5" />
            ) : null}
            <dt className="text-muted-foreground text-sm">{label}</dt>
            <dd className="text-foreground font-mono text-[15px] tabular-nums">
              <span data-amount>{amounts[key]}</span>
            </dd>
          </div>
        ))}
      </dl>

      <figcaption className="text-muted-foreground bg-muted/40 border-border border-t px-6 py-3 text-[13px] leading-relaxed">
        Every row is a real ledger account. None of this touches a blockchain.
      </figcaption>
    </figure>
  );
}
