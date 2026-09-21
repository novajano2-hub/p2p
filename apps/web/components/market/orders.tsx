"use client";

import { CalendarBlank, CaretDown, ChatCircleDots, Funnel, Receipt } from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { LoadFailed } from "@/components/app/load-failed";
import { useQuietRefresh } from "@/components/app/use-quiet-refresh";
import { EmptyState, PageHeader } from "@/components/app/panel";
import { useRealtimeEvent } from "@/components/app/realtime-provider";
import {
  Avatar,
  ListNotice,
  Segmented,
  TradePill,
  clockTime,
  dateTime,
  useCountdown,
  usdt,
} from "@/components/market/bits";
import { AppLink } from "@/components/ui/app-link";
import { Button, ButtonLink } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { PHONE, Sheet } from "@/components/ui/sheet";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { marketClient, type Trade, type TradeRole, type TradeStatus } from "@/lib/market/client";
import { FIAT } from "@/lib/market/labels";
import { formatSantim } from "@/lib/market/money";
import {
  NO_RANGE,
  RANGE_PRESETS,
  chatLink,
  rangeBounds,
  rangeIsSet,
  rangeLabel,
  rowAction,
  type RangeChoice,
} from "@/lib/market/orders";
import { presenceLabel } from "@/lib/market/presence";
import { toastFailure } from "@/lib/toast";
import { useMediaQuery } from "@/lib/use-media-query";

/*
  Every order the person is a party to, the Binance way: Processing is what
  still needs someone, All orders is everything, narrowed by which side they
  were on, the state, and when it was opened. A table on a desk, cards on a
  phone - one element per order either way.

  The button on a row names what is wanted from the viewer - Pay now,
  Release - or is just a way in. The chat button carries what is unread and
  goes straight into the chat.

  Re-read when the socket says an order changed or a message arrived, and on
  reconnect, so the unread counts and the status pills are never stale for
  long. Which tab is open is part of the address, so coming back from an
  order comes back to the same list.
*/

type Filters = { role: TradeRole | ""; status: TradeStatus | ""; range: RangeChoice };
const NO_FILTERS: Filters = { role: "", status: "", range: NO_RANGE };

const TYPES = [
  { value: "", label: "All" },
  { value: "BUYER", label: "Buy" },
  { value: "SELLER", label: "Sell" },
] as const satisfies readonly { value: TradeRole | ""; label: string }[];

/** A state as a filter names it: nobody's side of the table, unlike the pill on a row. */
const STATUSES: readonly { value: TradeStatus | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "AWAITING_FIAT_PAYMENT", label: "Awaiting payment" },
  { value: "BUYER_MARKED_PAID", label: "Awaiting release" },
  { value: "DISPUTED", label: "In dispute" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "EXPIRED", label: "Expired" },
  { value: "REFUNDED", label: "Refunded" },
];

const COLUMNS =
  "lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1.5fr)_minmax(0,1.9fr)_minmax(0,1.9fr)_14.75rem]";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; trades: Trade[]; nextCursor: string | null };

/** One list of orders: fetched, kept fresh by the socket, and grown a page at a time. */
function useOrders(
  scope: "open" | "all",
  role: TradeRole | "",
  status: TradeStatus | "",
  from: string | undefined,
  to: string | undefined,
) {
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [growing, setGrowing] = useState(false);
  // Whether "Show more" has added to the list since it was last loaded from the top.
  const grown = useRef(false);

  const load = useCallback(() => {
    void marketClient
      .trades({ scope, role: role || undefined, status: status || undefined, from, to })
      .then((result) => {
        if (result.ok) grown.current = false;
        setState((current) => {
          if (result.ok) {
            return { status: "ready", trades: result.trades, nextCursor: result.nextCursor };
          }
          return current.status === "ready"
            ? current
            : { status: "error", message: result.message };
        });
      });
  }, [scope, role, status, from, to]);

  useEffect(load, [load]);
  useRealtimeEvent("trade", load);
  useRealtimeEvent("message", load);
  useRealtimeEvent("connected", load);
  // Who is around changes without a word being sent. Not once more has been shown: a
  // load starts from the first page again, which would take the rest away every half minute.
  useQuietRefresh(() => {
    if (!grown.current) load();
  });

  const more = async () => {
    if (state.status !== "ready" || !state.nextCursor || growing) return;
    setGrowing(true);
    const result = await marketClient.trades({
      scope,
      role: role || undefined,
      status: status || undefined,
      from,
      to,
      cursor: state.nextCursor,
    });
    setGrowing(false);
    if (!result.ok) {
      toastFailure(result);
      return;
    }
    grown.current = true;
    setState({
      status: "ready",
      trades: [...state.trades, ...result.trades],
      nextCursor: result.nextCursor,
    });
  };

  const retry = () => {
    setState({ status: "loading" });
    load();
  };

  return { state, more, growing, retry };
}

export function Orders() {
  const router = useRouter();
  const tab = useSearchParams().get("tab") === "all" ? "all" : "processing";
  // Kept here rather than in its tab, so the count is on the tab whichever one is open.
  const processing = useOrders("open", "", "", undefined, undefined);
  const open = processing.state.status === "ready" ? processing.state : null;

  const items: TabItem[] = [
    {
      id: "processing",
      label: "Processing",
      badge:
        open && open.trades.length > 0
          ? `${open.trades.length}${open.nextCursor ? "+" : ""}`
          : undefined,
      content: (
        <OrderList
          {...processing}
          empty={
            <EmptyState
              icon={Receipt}
              title="Nothing in progress"
              description="When you buy or sell, the order and its escrow status appear here until it is completed, cancelled or expired."
              action={
                <ButtonLink href="/trade" size="sm" variant="secondary" arrow={false}>
                  Find an offer
                </ButtonLink>
              }
            />
          }
        />
      ),
    },
    { id: "all", label: "All orders", content: <AllOrders /> },
  ];

  return (
    <>
      <PageHeader
        title="Orders"
        description="Every order you have started or taken, open and finished."
      />
      <Tabs
        items={items}
        value={tab}
        onValueChange={(id) =>
          router.replace(id === "all" ? "/orders?tab=all" : "/orders", { scroll: false })
        }
        label="Processing or all orders"
      />
    </>
  );
}

/* ---------------------------------------------------------- all orders */

function AllOrders() {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const phone = useMediaQuery(PHONE);
  const bounds = rangeBounds(filters.range);
  const list = useOrders("all", filters.role, filters.status, bounds.from, bounds.to);
  const active =
    (filters.role ? 1 : 0) + (filters.status ? 1 : 0) + (rangeIsSet(filters.range) ? 1 : 0);

  return (
    <div className="flex flex-col gap-4">
      {/* A phone: what is chosen, and one button to the sheet that holds all three. */}
      <div className="flex items-center justify-between gap-3 sm:hidden">
        <p className="text-muted-foreground min-w-0 truncate text-[13px] tabular-nums">
          {summary(filters)}
        </p>
        <FiltersSheet value={filters} active={active} onChange={setFilters} />
      </div>

      {/* A desk: the three in a row. Drawn by CSS until the width is known, so a phone never flashes them. */}
      {phone ? null : (
        <div className="hidden flex-wrap items-center gap-3 sm:flex">
          <Segmented
            label="Order type"
            value={filters.role}
            onChange={(role) => setFilters({ ...filters, role })}
            options={TYPES}
          />
          <div className="w-52">
            <Select
              aria-label="Status"
              value={filters.status}
              onChange={(status) => setFilters({ ...filters, status: status as TradeStatus | "" })}
              options={STATUSES}
            />
          </div>
          <RangeControl
            value={filters.range}
            onChange={(range) => setFilters({ ...filters, range })}
          />
          <div className="flex-1" />
          {active > 0 ? (
            <Button
              type="button"
              variant="ghost"
              className="text-[13px]"
              onClick={() => setFilters(NO_FILTERS)}
            >
              Reset
            </Button>
          ) : null}
        </div>
      )}

      <OrderList
        {...list}
        empty={
          <EmptyState
            icon={Receipt}
            title={active > 0 ? "No orders match these filters" : "No orders yet"}
            description={
              active > 0
                ? "Try another type, status or stretch of time."
                : "Every order you start or take is kept here, whatever becomes of it."
            }
            action={
              active > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setFilters(NO_FILTERS)}
                >
                  Reset the filters
                </Button>
              ) : undefined
            }
          />
        }
      />
    </div>
  );
}

/** "Completed · 1 Sept 2026 – 19 Sept 2026", or that nothing is filtered. */
function summary(filters: Filters): string {
  const parts = [
    filters.role ? (filters.role === "BUYER" ? "Buy" : "Sell") : null,
    filters.status ? STATUSES.find((s) => s.value === filters.status)?.label : null,
    rangeIsSet(filters.range) ? rangeLabel(filters.range) : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "All orders, all time";
}

const chipClass = (pressed: boolean) =>
  cn(
    "rounded-control flex h-8 items-center border px-3 text-[13px] font-medium transition-colors duration-150",
    pressed
      ? "border-primary bg-primary-soft text-primary-soft-foreground"
      : "border-border text-muted-foreground hover:text-foreground",
  );

/** The days of a custom range: two date fields, as the browser draws them. */
function RangeDays({
  value,
  onChange,
}: {
  value: RangeChoice;
  onChange: (next: RangeChoice) => void;
}) {
  const fromId = useId();
  const toId = useId();
  const field =
    "rounded-control border-border bg-surface text-foreground focus:border-primary focus:ring-primary/25 h-10 w-full min-w-0 border px-3 text-sm tabular-nums focus:ring-2 focus:outline-none";
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={fromId} className="text-foreground text-[13px] font-medium">
          From
        </label>
        <input
          id={fromId}
          type="date"
          value={value.from}
          max={value.to || undefined}
          onChange={(event) => onChange({ ...value, from: event.target.value })}
          className={field}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={toId} className="text-foreground text-[13px] font-medium">
          To
        </label>
        <input
          id={toId}
          type="date"
          value={value.to}
          min={value.from || undefined}
          onChange={(event) => onChange({ ...value, to: event.target.value })}
          className={field}
        />
      </div>
    </div>
  );
}

function RangeChips({
  value,
  onChange,
}: {
  value: RangeChoice;
  onChange: (next: RangeChoice) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {RANGE_PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          aria-pressed={value.preset === preset.id}
          onClick={() => onChange({ ...value, preset: preset.id })}
          className={chipClass(value.preset === preset.id)}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}

/** The date range on a desk: a field that says the range, and a popover to choose it. */
function RangeControl({
  value,
  onChange,
}: {
  value: RangeChoice;
  onChange: (next: RangeChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (container.current && !container.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-label={`Date range: ${rangeLabel(value)}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "rounded-control bg-surface flex h-10 min-w-56 items-center justify-between gap-3 border px-3 text-sm transition-colors duration-150",
          rangeIsSet(value) ? "border-primary text-foreground" : "border-border text-foreground",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <CalendarBlank size={16} aria-hidden="true" className="text-muted-foreground shrink-0" />
          <span className="truncate tabular-nums">{rangeLabel(value)}</span>
        </span>
        <CaretDown size={14} weight="bold" aria-hidden="true" className="text-muted-foreground" />
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Date range"
          className="border-border bg-surface shadow-panel rounded-surface absolute top-full left-0 z-50 mt-2 flex w-80 flex-col gap-3 border p-4 motion-safe:animate-[menu-in_140ms_ease-out]"
        >
          <RangeChips value={value} onChange={onChange} />
          {value.preset === "custom" ? <RangeDays value={value} onChange={onChange} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** The three filters on a phone: chosen in a draft in the sheet everything else comes up in, applied at once. */
function FiltersSheet({
  value,
  active,
  onChange,
}: {
  value: Filters;
  active: number;
  onChange: (next: Filters) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Filters>(value);

  const section = "flex flex-col gap-2";
  const heading = "text-muted-foreground text-[12px] font-medium";

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setDraft(value);
          setOpen(true);
        }}
        className={cn(
          "rounded-control bg-surface flex h-9 shrink-0 items-center gap-2 border px-3 text-[13px] font-medium transition-colors duration-150",
          active > 0 ? "border-primary text-primary" : "border-border text-foreground",
        )}
      >
        <Funnel size={15} aria-hidden="true" />
        {active > 0 ? `Filters · ${active}` : "Filters"}
      </button>
      <Sheet
        open={open}
        title="Filters"
        onClose={() => setOpen(false)}
        closeLabel="Close the filters"
        className="gap-5 px-5 pb-5"
      >
        <fieldset className={section}>
          <legend className={cn(heading, "mb-2")}>Type</legend>
          <div className="flex flex-wrap gap-1.5">
            {TYPES.map((type) => (
              <button
                key={type.value || "all"}
                type="button"
                aria-pressed={draft.role === type.value}
                onClick={() => setDraft({ ...draft, role: type.value })}
                className={chipClass(draft.role === type.value)}
              >
                {type.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className={section}>
          <legend className={cn(heading, "mb-2")}>Status</legend>
          <div className="flex flex-wrap gap-1.5">
            {STATUSES.map((status) => (
              <button
                key={status.value || "all"}
                type="button"
                aria-pressed={draft.status === status.value}
                onClick={() => setDraft({ ...draft, status: status.value })}
                className={chipClass(draft.status === status.value)}
              >
                {status.value === "" ? "All" : status.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className={section}>
          <legend className={cn(heading, "mb-2")}>Date</legend>
          <RangeChips value={draft.range} onChange={(range) => setDraft({ ...draft, range })} />
          {draft.range.preset === "custom" ? (
            <RangeDays value={draft.range} onChange={(range) => setDraft({ ...draft, range })} />
          ) : null}
        </fieldset>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => {
              onChange(NO_FILTERS);
              setOpen(false);
            }}
          >
            Reset
          </Button>
          <Button
            type="button"
            size="md"
            onClick={() => {
              onChange(draft);
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------------- the list */

function OrderList({
  state,
  more,
  growing,
  retry,
  empty,
}: ReturnType<typeof useOrders> & { empty: ReactNode }) {
  if (state.status === "loading") {
    return (
      <Surface>
        <ListNotice>Loading…</ListNotice>
      </Surface>
    );
  }
  if (state.status === "error") {
    return (
      <Surface className="p-5">
        <LoadFailed message={state.message} onRetry={retry} />
      </Surface>
    );
  }
  if (state.trades.length === 0) return <Surface className="p-5">{empty}</Surface>;

  return (
    <>
      <Surface>
        <div
          aria-hidden="true"
          className={cn(
            "text-muted-foreground border-border hidden gap-4 border-b px-6 py-3 text-[12px] font-medium lg:grid",
            COLUMNS,
          )}
        >
          <span>Order</span>
          <span>Amount</span>
          <span>Counterparty</span>
          <span>Status</span>
          <span className="text-right">Chat and action</span>
        </div>
        <ul className="divide-border divide-y">
          {state.trades.map((trade) => (
            <OrderRow key={trade.id} trade={trade} />
          ))}
        </ul>
      </Surface>
      {state.nextCursor ? (
        <div className="mt-4 flex justify-center">
          <Button type="button" variant="secondary" size="sm" loading={growing} onClick={more}>
            Show more
          </Button>
        </div>
      ) : null}
    </>
  );
}

function Surface({ className, children }: { className?: string | undefined; children: ReactNode }) {
  return (
    <section
      aria-label="Orders"
      className={cn(
        "rounded-surface border-border bg-surface shadow-panel min-w-0 border",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** "Today, 14:02", or "18 Sept, 16:20". */
function openedAt(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  const today =
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate();
  return today ? `Today, ${clockTime(iso)}` : dateTime(iso);
}

/*
  One order: a row of the table from lg up, a card below it. The card puts
  the two pills on top, the amount beside the countdown or the date, who it is
  with, and the two buttons across the bottom.
*/
function OrderRow({ trade }: { trade: Trade }) {
  const waiting = trade.status === "AWAITING_FIAT_PAYMENT";
  const countdown = useCountdown(trade.paymentDeadline, waiting);
  const buying = trade.role === "BUYER";
  const other = trade.counterparty;
  const presence = presenceLabel(other);
  const action = rowAction(trade);
  const unread = trade.chat.unread;

  const timer = waiting ? (
    <span
      className={cn(
        "font-mono text-[13px] tabular-nums",
        countdown.secondsLeft < 300 ? "text-status-attention-fg" : "text-muted-foreground",
      )}
    >
      {countdown.expired ? "Time is up" : countdown.label}
    </span>
  ) : null;

  return (
    <li
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 px-4 py-4 sm:px-6 lg:items-center",
        COLUMNS,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1 max-lg:col-start-1 max-lg:row-start-1">
        <p className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-[22px] items-center rounded-full px-2 text-[12px] font-semibold whitespace-nowrap",
              buying
                ? "bg-status-complete text-status-complete-fg"
                : "bg-status-attention text-status-attention-fg",
            )}
          >
            {buying ? "Buy" : "Sell"} USDT
          </span>
          <span className="text-foreground text-[15px] font-semibold tabular-nums max-lg:hidden">
            {usdt(trade.amount)}
          </span>
        </p>
        <p className="text-muted-foreground text-[12px] tabular-nums max-lg:hidden">
          {openedAt(trade.createdAt)}
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-0.5 max-lg:col-start-1 max-lg:row-start-2">
        <p>
          <span className="text-foreground font-mono text-[22px] leading-tight font-medium tabular-nums lg:text-base">
            {formatSantim(trade.fiatSantim)}
          </span>{" "}
          <span className="text-muted-foreground text-[12px]">{FIAT}</span>
        </p>
        <p className="text-muted-foreground text-[12px] tabular-nums">
          <span className="lg:hidden">{usdt(trade.amount)} </span>at{" "}
          {formatSantim(trade.priceSantim)} {FIAT}
        </p>
      </div>

      <div className="flex min-w-0 items-center gap-2.5 max-lg:col-span-2 max-lg:row-start-3">
        <Avatar name={other.username} online={other.online} />
        <p className="min-w-0">
          <span className="text-foreground block truncate text-sm font-semibold">
            {other.username}
          </span>
          {presence ? (
            <span
              className={cn(
                "block text-[12px]",
                other.online ? "text-online font-medium" : "text-muted-foreground",
              )}
            >
              {presence}
            </span>
          ) : null}
        </p>
      </div>

      {/* Across both columns on a card: a long status must not set the width the amount's line is left with. */}
      <div className="flex items-center gap-2.5 max-lg:col-span-2 max-lg:col-start-1 max-lg:row-start-1 max-lg:justify-self-end">
        <TradePill trade={trade} />
        <span className="max-lg:hidden">{timer}</span>
      </div>

      {/* A card's second line, on the right: how long is left, or when it was opened. */}
      <p className="text-muted-foreground self-end justify-self-end text-[12px] tabular-nums max-lg:col-start-2 max-lg:row-start-2 lg:hidden">
        {timer ?? openedAt(trade.createdAt)}
      </p>

      <div className="flex items-center gap-2 max-lg:col-span-2 max-lg:row-start-4 lg:justify-end lg:gap-2.5">
        <AppLink
          href={chatLink(trade.id)}
          aria-label={
            unread > 0
              ? `Chat with ${other.username}, ${unread} unread`
              : `Chat with ${other.username}`
          }
          className="rounded-control border-border bg-surface text-foreground hover:text-primary relative flex h-10 items-center justify-center gap-2 border text-sm font-semibold transition-colors duration-150 max-lg:flex-1 lg:size-10"
        >
          <ChatCircleDots size={17} aria-hidden="true" />
          <span className="lg:sr-only">Chat</span>
          {unread > 0 ? (
            <span
              aria-hidden="true"
              className="bg-primary text-primary-foreground flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] leading-none font-bold tabular-nums lg:absolute lg:-top-1.5 lg:-right-1.5"
            >
              {unread}
            </span>
          ) : null}
        </AppLink>
        <ButtonLink
          href={`/orders/${trade.id}`}
          variant={action.primary ? "primary" : "secondary"}
          size="md"
          arrow={false}
          className="max-lg:flex-1 lg:h-[34px] lg:w-[6.5rem] lg:px-3 lg:text-[13px]"
        >
          {action.label}
        </ButtonLink>
      </div>
    </li>
  );
}
