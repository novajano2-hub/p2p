"use client";

import { ArrowsClockwise, CaretDown, Tray, Warning } from "@phosphor-icons/react";
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";

import { CopyTextButton } from "@/components/app/copy-button";
import { LoadFailed } from "@/components/app/load-failed";
import { EmptyState, PageHeader, Panel } from "@/components/app/panel";
import { ActivityList, fromDeposit } from "@/components/wallet/activity";
import { BackLink, CoinField, NetworkSelect, SummaryRow } from "@/components/wallet/shared";
import { Step, Steps } from "@/components/wallet/steps";
import { formatMicro } from "@/lib/money";
import { ASSET, DEFAULT_NETWORK, networkById, networkLabel, type NetworkId } from "@/lib/wallet";
import { walletClient, type Deposit, type DepositAddress } from "@/lib/wallet/client";
import { useInFlight } from "@/lib/wallet/use-in-flight";

/*
  Receiving USDT.

  The deposit screen every exchange this audience already uses: coin, network,
  address, down one line. And for one reason above the rest - the network and
  the address belong to each other. An address is only valid on the chain it
  was issued for, and USDT sent on a different one is gone with nobody to
  appeal to. So the network is settled before the address is shown, and the
  warning is on the screen rather than behind a link: beside the steps on a
  desk, above them on a phone, where it is read before the address is copied.

  BIRQ has one coin and one live network today, so the first two steps arrive
  answered and the address is on screen at once. The networks that are coming
  stay in the list, visibly refused rather than quietly missing.

  Every figure beside the address - the minimum, the confirmations - is the
  server's own, read from the configuration that enforces them. The address is
  the customer's alone and does not change, so it is theirs to save and reuse.
*/

type State =
  | { status: "loading" }
  | { status: "ready"; address: DepositAddress; qr: string }
  | { status: "error"; message: string };

export function DepositView() {
  const [networkId, setNetworkId] = useState<NetworkId>(DEFAULT_NETWORK);
  const [state, setState] = useState<State>({ status: "loading" });
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [attempt, setAttempt] = useState(0);
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
  }, [attempt]);

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

  return (
    <>
      <BackLink />
      <PageHeader
        title={`Deposit ${ASSET.symbol}`}
        description="Send from another wallet or exchange to your BIRQ address."
      />

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-5 lg:grid-rows-[auto_1fr] lg:items-start lg:gap-6">
        {/* Read before the address is copied: first on a phone, beside the steps on a desk. */}
        <Panel title="Before you send" className="lg:col-span-2 lg:col-start-4 lg:row-start-1">
          <div
            role="note"
            className="rounded-control border-destructive/30 bg-status-attention text-status-attention-fg flex items-start gap-2.5 border px-3.5 py-3 text-[13px] leading-relaxed"
          >
            <Warning size={16} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
            <p>
              <strong className="font-semibold">
                Send only {ASSET.symbol} on {networkLabel(network)}.
              </strong>{" "}
              Anything else, or the right asset on the wrong network, cannot be recovered by us or
              by anyone.
            </p>
          </div>
          <p className="text-muted-foreground mt-3 text-[13px] leading-relaxed max-lg:hidden">
            A deposit lands in your available balance. It is not committed to anything until you
            open or accept an order, and it can be withdrawn again at any time.
          </p>
        </Panel>

        <Panel className="lg:col-span-3 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <Steps label="How to deposit">
            <Step n={1} title="Coin" done>
              <CoinField />
            </Step>

            <Step n={2} title="Network" done>
              <NetworkSelect value={networkId} onChange={setNetworkId} />
              <p className="text-muted-foreground mt-2 text-[13px] leading-relaxed">
                Must match the wallet at the other end.
              </p>
            </Step>

            <Step n={3} title="Deposit address" last>
              {state.status === "error" ? (
                <LoadFailed
                  message={state.message}
                  onRetry={() => {
                    setState({ status: "loading" });
                    setAttempt((value) => value + 1);
                  }}
                  className="py-4"
                />
              ) : (
                <>
                  <div className="rounded-control bg-muted flex flex-col items-center gap-4 p-4 sm:flex-row sm:gap-5">
                    <div className="rounded-control border-border flex size-36 shrink-0 items-center justify-center overflow-hidden border bg-white p-1.5">
                      {state.status === "ready" ? (
                        // eslint-disable-next-line @next/next/no-img-element -- a data: URI made in the browser; there is nothing for the optimiser to fetch
                        <img
                          src={state.qr}
                          alt={`QR code for your ${networkLabel(network)} deposit address`}
                          className="size-full object-contain"
                        />
                      ) : (
                        <span className="text-[12px] text-neutral-500">Loading&hellip;</span>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-3 max-sm:w-full">
                      <div>
                        <p className="text-muted-foreground text-[12px]">
                          Your {network.standard} address
                        </p>
                        <p className="text-foreground mt-0.5 font-mono text-[13.5px] leading-relaxed break-all">
                          {address ? address.address : "…"}
                        </p>
                      </div>
                      {address ? (
                        <CopyTextButton
                          value={address.address}
                          label="Copy deposit address"
                          text="Copy address"
                          className="bg-surface max-sm:h-11 max-sm:w-full max-sm:justify-center max-sm:text-sm sm:self-start"
                        />
                      ) : null}
                    </div>
                  </div>
                  <p className="text-muted-foreground mt-3 text-[13px] leading-relaxed">
                    This address is yours alone and will not change, so you can save it and reuse
                    it.
                  </p>
                  <dl className="divide-border border-border mt-3 divide-y border-t">
                    <SummaryRow label="Minimum deposit">
                      {address ? `${formatMicro(address.minimumDeposit)} ${ASSET.symbol}` : "—"}
                    </SummaryRow>
                    <SummaryRow label="Credited after">
                      {address ? `${address.confirmationsRequired} confirmations` : "—"}
                    </SummaryRow>
                    <SummaryRow label="Usually arrives in">{network.arrival}</SummaryRow>
                  </dl>
                </>
              )}
            </Step>
          </Steps>
        </Panel>

        <Panel className="lg:col-span-2 lg:col-start-4 lg:row-start-2">
          <p className="text-muted-foreground text-[13px] leading-relaxed lg:hidden">
            A deposit lands in your available balance. It is not committed to anything until you
            open or accept an order, and it can be withdrawn again at any time.
          </p>
          <details className="faq-item max-lg:border-border max-lg:mt-4 max-lg:border-t max-lg:pt-4">
            <summary className="text-foreground flex items-center justify-between gap-2 text-sm font-semibold">
              What if something goes wrong?
              <CaretDown
                size={14}
                weight="bold"
                aria-hidden="true"
                className="faq-chevron text-muted-foreground"
              />
            </summary>
            <div className="text-muted-foreground mt-3 flex flex-col gap-2 text-[13px] leading-relaxed">
              <p>
                A deposit under the minimum is not credited automatically. It is held and a person
                releases it by hand, so contact support with the transaction hash.
              </p>
              <p>
                A deposit on an unsupported network cannot be recovered. This is true of every
                exchange, and it is why the network comes before the address on this screen.
              </p>
              <p>
                A large deposit may be held for a check before it is credited. Nothing is wrong; it
                is usually a matter of hours and the full amount is credited.
              </p>
            </div>
          </details>
        </Panel>
      </div>

      <Panel
        title="Recent deposits"
        className="mt-4 lg:mt-6"
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
          <ActivityList
            label="Recent deposits"
            items={deposits.map((deposit) => fromDeposit(deposit))}
          />
        )}
      </Panel>
    </>
  );
}
