"use client";

import { useEffect, useState } from "react";

import { Panel } from "@/components/app/panel";
import { AppLink } from "@/components/ui/app-link";
import { marketClient } from "@/lib/market/client";
import { FIAT } from "@/lib/market/labels";
import { formatSantim } from "@/lib/market/money";

/*
  The best price on each side of the market right now, which is the one
  number most customers open the app to check: the lowest a seller is
  asking, the highest a buyer is bidding, read from the same lists the
  marketplace shows.
*/

type Best = { buy: string | null; sell: string | null };

export function MarketSnapshot({ className }: { className?: string | undefined }) {
  const [best, setBest] = useState<Best | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([
      marketClient.marketplace({ want: "BUY", limit: 1 }),
      marketClient.marketplace({ want: "SELL", limit: 1 }),
    ]).then(([buy, sell]) => {
      if (!live) return;
      setBest({
        buy: buy.ok ? (buy.offers[0]?.priceSantim ?? null) : null,
        sell: sell.ok ? (sell.offers[0]?.priceSantim ?? null) : null,
      });
    });
    return () => {
      live = false;
    };
  }, []);

  const sides = [
    { label: "Buy USDT", hint: "lowest price", href: "/trade?want=BUY", price: best?.buy ?? null },
    {
      label: "Sell USDT",
      hint: "highest price",
      href: "/trade?want=SELL",
      price: best?.sell ?? null,
    },
  ];

  return (
    <Panel
      title="Market"
      description={`Best prices right now, in ${FIAT} per USDT.`}
      action={
        <AppLink
          href="/trade"
          className="text-primary hover:text-primary-hover font-medium underline-offset-4 hover:underline"
        >
          All ads
        </AppLink>
      }
      className={className}
    >
      <dl className="divide-border divide-y">
        {sides.map((side) => (
          <div key={side.label} className="flex items-center justify-between gap-4 py-3">
            <dt>
              <AppLink
                href={side.href}
                className="text-foreground block text-sm font-medium hover:underline"
              >
                {side.label}
              </AppLink>
              <span className="text-muted-foreground block text-[12px]">{side.hint}</span>
            </dt>
            <dd className="text-right">
              <span className="text-foreground block font-mono text-lg font-medium tabular-nums">
                {side.price ? formatSantim(side.price) : "—"}
              </span>
              <span className="text-muted-foreground block text-[12px]">
                {best === null ? "Loading…" : side.price ? FIAT : "No ads yet"}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
