"use client";

import { ArrowsClockwise, CaretDown, Tray, Warning } from "@phosphor-icons/react";
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";

import { CopyButton } from "@/components/app/copy-button";
import { EmptyState, PageHeader, Panel } from "@/components/app/panel";
import { ActivityList, fromDeposit } from "@/components/wallet/activity";
import { BackLink, NetworkPicker, Note, SummaryRow } from "@/components/wallet/shared";
import { formatMicro } from "@/lib/money";
import { ASSET, DEFAULT_NETWORK, networkById, networkLabel, type NetworkId } from "@/lib/wallet";
import { walletClient, type Deposit, type DepositAddress } from "@/lib/wallet/client";
import { useInFlight } from "@/lib/wallet/use-in-flight";

/*
  Receiving USDT.

  Modelled on the deposit screen every exchange this audience already uses,
  and for one reason above the rest: the network and the address belong to
  each other. An address is only valid on the chain it was issued for, and
  USDT sent on a different one is gone with nobody to appeal to. So the
  network is chosen first, the pair is shown together, and the warning is on
  the screen rather than behind a link.

  The address is real now, and every figure beside it - the minimum, the
  confirmations - is the server's own, read from the same configuration that
  enforces them. The address is the customer's alone and does not change, so
  it is theirs to save and reuse.
*/

type State =
  | { status: "loading" }
  | { status: "ready"; address: DepositAddress; qr: string }
  | { status: "error"; message: string };

export function DepositView() {
  const [networkId, setNetworkId] = useState<NetworkId>(DEFAULT_NETWORK);
  const [state, setState] = useState<State>({ status: "loading" });
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const network = networkById(networkId);

  useEffect(() => {
    let live = true;
    void (async () => {
      const result = await walletClient.address();
      if (!live) return;
      if (!result.ok) {
        setState({ status: "error", message: result.message });
        return;
      }
      // A plain address string, which is what every wallet app expects to
      // scan; a URI scheme differs per chain and a wrong one silently
      // produces a scan that fills in nothing.
      const qr = await QRCode.toDataURL(result.address.address, { width: 384, margin: 1 });
      if (live) setState({ status: "ready", address: result.address, qr });
    })();
    return () => {
      live = false;
    };
  }, []);

  const loadDeposits = useCallback(() => {
    void walletClient.deposits().then((result) => {
      if (result.ok) setDeposits(result.deposits);
    });
  }, []);
  useEffect(loadDeposits, [loadDeposits]);

  // A deposit credits itself a few blocks from now, with nothing happening in
  // this tab. Watch while one is on its way; stop once none is.
  useInFlight(
    deposits.some((deposit) => deposit.status === "DETECTED" || deposit.status === "CONFIRMING"),
    loadDeposits,
  );

  const address = state.status === "ready" ? state.address : null;
  const detail = address
    ? `Minimum ${formatMicro(address.minimumDeposit)} ${ASSET.symbol}, credited after ${address.confirmationsRequired} confirmations.`
    : "Loading…";

  return (
    <>
      <BackLink />
      <PageHeader
        title={`Deposit ${ASSET.symbol}`}
        description="Send from another wallet or exchange to your BIRQ address."
      />

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        <div className="flex flex-col gap-4 lg:col-span-2 lg:gap-6">
          <Panel>
            <NetworkPicker value={networkId} onChange={setNetworkId} detail={detail} />
          </Panel>

          <Panel title="Your deposit address">
            {state.status === "error" ? (
              <p role="alert" className="text-destructive text-[13px]">
                {state.message}
              </p>
            ) : null}

            <div className="flex flex-col items-center gap-5 py-2 sm:flex-row sm:items-start sm:gap-6">
              <div className="rounded-surface border-border bg-surface flex size-40 shrink-0 items-center justify-center overflow-hidden border p-2">
                {state.status === "ready" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a data: URI made in the browser; there is nothing for the optimiser to fetch
                  <img
                    src={state.qr}
                    alt={`QR code for your ${networkLabel(network)} deposit address`}
                    className="size-full object-contain"
                  />
                ) : (
                  <span className="text-muted-foreground text-[12px]">Loading&hellip;</span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-muted-foreground text-[12px] font-medium">Network</p>
                <p className="text-foreground mt-0.5 text-[15px] font-medium">
                  {networkLabel(network)}
                </p>

                <p className="text-muted-foreground mt-4 text-[12px] font-medium">Address</p>
                <div className="rounded-control border-border bg-muted mt-1.5 flex items-start gap-2 border px-3.5 py-3">
                  <span className="text-foreground min-w-0 flex-1 font-mono text-[13px] break-all">
                    {address ? address.address : "…"}
                  </span>
                  {address ? (
                    <CopyButton
                      value={address.address}
                      label="Copy deposit address"
                      className="-my-1 shrink-0"
                    />
                  ) : null}
                </div>

                <p className="text-muted-foreground mt-3 text-[12px] leading-relaxed">
                  This address is yours alone and will not change, so you can save it and reuse it
                  for every deposit on this network.
                </p>
              </div>
            </div>
          </Panel>

          <Panel
            title="Your deposits"
            action={
              <button
                type="button"
                onClick={loadDeposits}
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 font-medium transition-colors duration-150"
              >
                <ArrowsClockwise size={14} weight="bold" aria-hidden="true" />
                Refresh
              </button>
            }
          >
            {deposits.length === 0 ? (
              <EmptyState
                icon={Tray}
                title="Nothing yet"
                description="Deposits appear here as soon as we see them on the chain, before they are credited."
              />
            ) : (
              <ActivityList items={deposits.map((deposit) => fromDeposit(deposit))} />
            )}
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
              <SummaryRow label="Asset">{address?.asset ?? ASSET.symbol}</SummaryRow>
              <SummaryRow label="Network">{networkLabel(network)}</SummaryRow>
              <SummaryRow label="Minimum deposit">
                {address ? `${formatMicro(address.minimumDeposit)} ${ASSET.symbol}` : "—"}
              </SummaryRow>
              <SummaryRow label="Credited after">
                {address ? `${address.confirmationsRequired} confirmations` : "—"}
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
                  A deposit under the minimum is not credited automatically. It is held and a person
                  releases it by hand, so contact support with the transaction hash.
                </p>
                <p>
                  A deposit on an unsupported network cannot be recovered. This is true of every
                  exchange, and it is why the network is the first thing on this screen.
                </p>
                <p>
                  A large deposit may be held for a check before it is credited. Nothing is wrong;
                  it is usually a matter of hours and the full amount is credited.
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
