"use client";

import { useEffect, useState } from "react";

import { Panel } from "@/components/app/panel";
import { dateTime } from "@/components/market/bits";
import { marketClient, type Trade, type TradeEvent } from "@/lib/market/client";
import { EVENT_LABELS } from "@/lib/market/labels";

/*
  What happened, in order, with who did it: the record a person reads when
  they want to be sure, and the one a reviewer reconstructs from the same
  rows. Re-read whenever the trade changes.
*/
export function Timeline({ trade }: { trade: Trade }) {
  const [events, setEvents] = useState<TradeEvent[]>([]);
  const version = trade.updatedAt;

  useEffect(() => {
    let live = true;
    void marketClient.tradeEvents(trade.id).then((result) => {
      if (live && result.ok) setEvents(result.events);
    });
    return () => {
      live = false;
    };
  }, [trade.id, version]);

  if (events.length === 0) return null;

  const actorName = (event: TradeEvent): string => {
    switch (event.actor) {
      case "ME":
        return "You";
      case "COUNTERPARTY":
        return trade.counterparty.username;
      case "ADMIN":
        return "A reviewer";
      case "SYSTEM":
        return "The system";
    }
  };

  return (
    <Panel title="History">
      <ol className="flex flex-col gap-3">
        {events.map((event) => (
          <li key={event.id} className="flex gap-3 text-[13px]">
            <span aria-hidden="true" className="bg-border mt-1.5 size-2 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <p className="text-foreground">
                {EVENT_LABELS[event.kind] ?? event.kind}
                <span className="text-muted-foreground"> · {actorName(event)}</span>
              </p>
              <p className="text-muted-foreground text-[12px] tabular-nums">{dateTime(event.createdAt)}</p>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
