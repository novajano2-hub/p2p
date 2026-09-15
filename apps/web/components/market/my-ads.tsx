"use client";

import { Megaphone } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

import { EmptyState, PageHeader, Panel } from "@/components/app/panel";
import { FormError } from "@/components/auth/notices";
import { BackTo, ConfirmButton, ListNotice, PaymentKindChips, birr, usdt } from "@/components/market/bits";
import { Button, ButtonLink } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { marketClient, type MyOffer } from "@/lib/market/client";
import { ASSET, FIAT, OFFER_STATUS } from "@/lib/market/labels";
import { formatSantim } from "@/lib/market/money";

/*
  The ads a person has posted: live, paused, or closed, with what is left
  on each. Pausing takes an ad off the marketplace without losing its
  place; closing ends it. Neither touches a trade already running.
*/

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; offers: MyOffer[] };

export function MyAds() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void marketClient.myOffers().then((result) => {
      setState(
        result.ok ? { status: "ready", offers: result.offers } : { status: "error", message: result.message },
      );
    });
  }, []);
  useEffect(refresh, [refresh]);

  const act = async (offer: MyOffer, action: "pause" | "resume" | "close") => {
    setError(null);
    setBusy(offer.id);
    const result = await marketClient.setOfferStatus(offer.id, action);
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    refresh();
  };

  return (
    <>
      <BackTo href="/trade">Marketplace</BackTo>
      <PageHeader title="My ads" description="What you have posted, and what is left on each.">
        <ButtonLink href="/trade/ads/new" size="sm" arrow={false}>
          Post an ad
        </ButtonLink>
      </PageHeader>

      <Panel>
        {error ? <FormError message={error} /> : null}
        {state.status === "loading" ? (
          <ListNotice>Loading…</ListNotice>
        ) : state.status === "error" ? (
          <ListNotice>{state.message}</ListNotice>
        ) : state.offers.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="No ads yet"
            description="Post an ad to sell USDT at your price, or to buy it. Buyers and sellers find you in the marketplace."
            action={
              <ButtonLink href="/trade/ads/new" size="sm" variant="secondary" arrow={false}>
                Post an ad
              </ButtonLink>
            }
          />
        ) : (
          <ul className="divide-border divide-y">
            {state.offers.map((offer) => {
              const status = OFFER_STATUS[offer.status];
              const kinds = offer.paymentMethods.map((method) => method.kind);
              return (
                <li key={offer.id} className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-foreground text-[15px] font-semibold">
                        {offer.side === "SELL" ? `Selling ${ASSET}` : `Buying ${ASSET}`}
                      </span>
                      <span className="text-foreground font-mono text-[15px] tabular-nums">
                        at {formatSantim(offer.priceSantim)} {FIAT}
                      </span>
                      <StatusPill status={status.tone}>{status.label}</StatusPill>
                    </div>
                    <p className="text-muted-foreground mt-1 text-[13px] tabular-nums">
                      {usdt(offer.remainingAmount)} of {usdt(offer.totalAmount)} left ·{" "}
                      {formatSantim(offer.minSantim)} – {birr(offer.maxSantim)} a trade ·{" "}
                      {offer.paymentWindowMinutes} min to pay
                    </p>
                    <PaymentKindChips kinds={[...new Set(kinds)]} className="mt-1.5" />
                  </div>
                  {offer.status !== "CLOSED" ? (
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <ButtonLink href={`/trade/ads/${offer.id}/edit`} variant="secondary" size="sm" arrow={false}>
                        Edit
                      </ButtonLink>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        loading={busy === offer.id}
                        onClick={() => act(offer, offer.status === "ACTIVE" ? "pause" : "resume")}
                      >
                        {offer.status === "ACTIVE" ? "Pause" : "Resume"}
                      </Button>
                      <ConfirmButton
                        question="Close this ad?"
                        confirmLabel="Close it"
                        variant="ghost"
                        onConfirm={() => act(offer, "close")}
                      >
                        Close
                      </ConfirmButton>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
