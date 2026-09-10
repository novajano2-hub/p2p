"use client";

import { CaretDown, Lock, QrCode, Warning } from "@phosphor-icons/react";
import { useState } from "react";

import { PageHeader, Panel } from "@/components/app/panel";
import {
  BackLink,
  NetworkPicker,
  Note,
  NotOpenNotice,
  SummaryRow,
} from "@/components/wallet/shared";
import { ASSET, DEFAULT_NETWORK, formatAmount, networkById, networkLabel } from "@/lib/wallet";

/*
  Receiving USDT: pick the network, then copy the address it produced.

  Modelled on the deposit screen every exchange this audience already uses,
  and for one reason above the rest - the network and the address belong to
  each other. An address is only valid on the chain it was issued for, and
  USDT sent on a different one is gone with nobody to appeal to. So the
  network is chosen first, the pair is shown together, and the warning is on
  the screen rather than behind a link.

  The address itself is not here, because there is nothing behind it yet.
  A plausible-looking placeholder on this screen is the one thing in this app
  that could cost somebody real money, so the panel is visibly locked instead.
*/
export function DepositView() {
  const [networkId, setNetworkId] = useState(DEFAULT_NETWORK);
  const network = networkById(networkId);

  return (
    <>
      <BackLink />
      <PageHeader
        title={`Deposit ${ASSET.symbol}`}
        description="Send from another wallet or exchange to your BIRQ address."
      />

      <NotOpenNotice what="Deposits" />

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        <div className="flex flex-col gap-4 lg:col-span-2 lg:gap-6">
          <Panel>
            <NetworkPicker value={networkId} onChange={setNetworkId} purpose="deposit" />
          </Panel>

          <Panel title="Your deposit address">
            <div className="flex flex-col items-center gap-5 py-2 sm:flex-row sm:items-start sm:gap-6">
              <div className="rounded-surface border-border bg-muted flex size-40 shrink-0 items-center justify-center border border-dashed">
                <QrCode size={40} weight="duotone" aria-hidden="true" className="text-sage" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-muted-foreground text-[12px] font-medium">Network</p>
                <p className="text-foreground mt-0.5 text-[15px] font-medium">
                  {networkLabel(network)}
                </p>

                <p className="text-muted-foreground mt-4 text-[12px] font-medium">Address</p>
                <div className="rounded-control border-border bg-muted text-muted-foreground mt-1.5 flex items-center gap-2.5 border border-dashed px-3.5 py-3 text-[13px]">
                  <Lock size={15} weight="fill" aria-hidden="true" className="shrink-0" />
                  <span>Appears here once custody is connected.</span>
                </div>

                <p className="text-muted-foreground mt-3 text-[12px] leading-relaxed">
                  The address will be yours alone and will not change, so you can save it and reuse
                  it for every deposit on this network.
                </p>
              </div>
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-4 lg:gap-6">
          <Panel title="Before you send">
            <div
              role="note"
              className="rounded-control border-destructive/30 bg-status-attention text-status-attention-fg flex items-start gap-2.5 border px-3.5 py-3 text-[13px] leading-relaxed"
            >
              <Warning size={16} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
              <p>
                Send only {ASSET.symbol} on {networkLabel(network)}. Anything else, or the right
                asset on the wrong network, cannot be recovered by us or by anyone.
              </p>
            </div>

            <dl className="divide-border mt-4 divide-y">
              <SummaryRow label="Asset">{ASSET.symbol}</SummaryRow>
              <SummaryRow label="Network">{networkLabel(network)}</SummaryRow>
              <SummaryRow label="Minimum deposit">
                {formatAmount(network.minDeposit)} {ASSET.symbol}
              </SummaryRow>
              <SummaryRow label="Credited after">
                {network.confirmations} confirmation{network.confirmations === 1 ? "" : "s"}
              </SummaryRow>
              <SummaryRow label="Usually arrives in">{network.arrival}</SummaryRow>
            </dl>

            <details className="faq-item border-border mt-4 border-t pt-4">
              <summary className="text-foreground flex items-center justify-between gap-2 text-[13px] font-medium">
                What if something goes wrong?
                <CaretDown
                  size={14}
                  weight="bold"
                  aria-hidden="true"
                  className="faq-chevron text-muted-foreground"
                />
              </summary>
              <div className="text-muted-foreground mt-3 flex flex-col gap-2 text-[12px] leading-relaxed">
                <p>
                  A deposit under the minimum is not credited automatically and needs support to
                  release it by hand.
                </p>
                <p>
                  A deposit on an unsupported network cannot be recovered. This is true of every
                  exchange, and it is why the network is the first thing on this screen.
                </p>
              </div>
            </details>
          </Panel>

          <Panel title="Where it goes">
            <Note>
              A deposit lands in your available balance. It is not committed to anything until you
              open or accept a trade, and it can be withdrawn again at any time.
            </Note>
          </Panel>
        </div>
      </div>
    </>
  );
}
