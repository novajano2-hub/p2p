"use client";

import { ArrowClockwise, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

import {
  Amount,
  Code,
  dateTime,
  Empty,
  Notice,
  PageHeading,
  Panel,
  RowLink,
  Table,
  Tag,
  TD,
  TD_NUM,
  TH,
} from "@/components/admin/admin-bits";
import { ActionButton, NeedsRole, useAdmin } from "@/components/admin/admin-shell";
import { isZeroMicro } from "@/lib/admin/money";
import {
  reconciliationClient,
  type ReconciliationBreak,
  type ReconciliationReport,
  type Sweep,
} from "@/lib/admin/operations";
import { BREAK_TONE, BREAK_WORDS, SWEEP_TONE } from "@/lib/admin/operations-view";

/*
  The only screen in the system that looks outside the database.

  Everything else here is internally consistent by construction and would not
  notice if the coins were simply gone. This asks the chain what it holds at
  every address we control and holds it against what the ledger says we hold,
  position by position, so the arithmetic can be checked by hand.

  Nothing on this screen posts anything. A break is raised, never corrected:
  one direction is money we may owe somebody and the other is a loss, and
  software cannot tell them apart (ADR-0009). Resolving one is a person's
  act, on its own screen, behind a different role.
*/

type State =
  | { status: "loading" }
  | { status: "ready"; report: ReconciliationReport }
  | { status: "error"; message: string };

type Loaded = Awaited<ReturnType<typeof load>>;

/** Everything the screen needs, fetched together and without touching state. */
async function load() {
  const [report, open, swept] = await Promise.all([
    reconciliationClient.report(),
    reconciliationClient.breaks("OPEN"),
    reconciliationClient.sweeps(),
  ]);
  return { report, open, swept };
}

export function Reconciliation() {
  const admin = useAdmin();
  const may = admin.roles.includes("LEDGER_VIEWER");
  const [state, setState] = useState<State>({ status: "loading" });
  const [breaks, setBreaks] = useState<ReconciliationBreak[]>([]);
  const [sweeps, setSweeps] = useState<{ sweeps: Sweep[]; unswept: string } | null>(null);

  /*
    One pass, plus the two cheap reads beside it. A pass asks the chain about
    every address we have, so it is not free and it is not on a timer: it
    happens when somebody opens this screen, and again when they ask.
  */
  const apply = useCallback((loaded: Loaded) => {
    setState(
      loaded.report.ok
        ? { status: "ready", report: loaded.report.report }
        : { status: "error", message: loaded.report.message },
    );
    if (loaded.open.ok) setBreaks(loaded.open.breaks);
    if (loaded.swept.ok) setSweeps({ sweeps: loaded.swept.sweeps, unswept: loaded.swept.unswept });
  }, []);

  const run = useCallback(async () => {
    apply(await load());
  }, [apply]);

  useEffect(() => {
    if (!may) return;
    let live = true;
    void load().then((loaded) => {
      if (live) apply(loaded);
    });
    return () => {
      live = false;
    };
  }, [may, apply]);

  const heading = (
    <PageHeading
      title="Reconciliation"
      description="What the chain holds, against what the ledger says it holds."
      actions={
        may && state.status !== "loading" ? (
          <ActionButton
            label={
              <span className="flex items-center gap-1.5">
                <ArrowClockwise size={14} weight="bold" aria-hidden="true" />
                Check again
              </span>
            }
            busyLabel="Checking…"
            variant="secondary"
            size="sm"
            onRun={run}
          />
        ) : undefined
      }
    />
  );

  if (!may) {
    return (
      <>
        {heading}
        <NeedsRole role="LEDGER_VIEWER" />
      </>
    );
  }
  if (state.status !== "ready") {
    return (
      <>
        {heading}
        {state.status === "loading" ? (
          <Notice tone="loading">Asking the chain&hellip;</Notice>
        ) : (
          <Notice tone="error">{state.message}</Notice>
        )}
      </>
    );
  }

  const { report } = state;

  return (
    <>
      {heading}

      <div
        className={
          report.agrees
            ? "rounded-surface border-status-complete-fg/25 bg-status-complete/40 mb-5 flex items-start gap-3 border px-5 py-4"
            : "rounded-surface border-status-attention-fg/30 bg-status-attention/30 mb-5 flex items-start gap-3 border px-5 py-4"
        }
      >
        {report.agrees ? (
          <CheckCircle
            size={20}
            weight="fill"
            aria-hidden="true"
            className="text-status-complete-fg mt-0.5 shrink-0"
          />
        ) : (
          <WarningCircle
            size={20}
            weight="fill"
            aria-hidden="true"
            className="text-status-attention-fg mt-0.5 shrink-0"
          />
        )}
        <div className="min-w-0">
          <p className="text-foreground text-[15px] font-medium">
            {report.agrees
              ? "The chain and the ledger agree"
              : `${report.breaksOpen} position${report.breaksOpen === 1 ? "" : "s"} do not agree`}
          </p>
          <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">
            Checked against {report.network} at {dateTime.format(new Date(report.checkedAt))}.
            Nothing was posted: this pass only looks.
          </p>
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Figure label="The ledger says we hold" value={report.ledgerAssets} />
        <Figure label="The chain shows" value={report.chainAssets} />
        <Figure
          label="In transit"
          value={report.inTransit}
          note="Ledger assets mid-transaction, so on no address yet."
        />
      </div>

      <Panel title="Position by position" className="mb-5">
        <Table>
          <thead>
            <tr className="border-border border-b">
              <th className={TH}>Account</th>
              <th className={TH}>What is being compared</th>
              <th className={`${TH} text-right`}>Ledger</th>
              <th className={`${TH} text-right`}>Chain</th>
              <th className={`${TH} text-right`}>Difference</th>
            </tr>
          </thead>
          <tbody>
            {report.positions.map((position) => (
              <tr key={position.accountCode} className="border-border border-b last:border-0">
                <td className={TD}>
                  <Code>{position.accountCode}</Code>
                </td>
                <td className={`${TD} text-muted-foreground`}>{position.describes}</td>
                <td className={TD_NUM}>
                  <Amount value={position.ledgerBalance} />
                </td>
                <td className={TD_NUM}>
                  <Amount value={position.chainBalance} />
                </td>
                <td className={TD_NUM}>
                  {position.agrees ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className="text-destructive font-medium">
                      <Amount value={position.difference} />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        {report.positions.length === 0 ? <Empty>Nothing to compare yet.</Empty> : null}
      </Panel>

      <Panel title="Open breaks" className="mb-5">
        {breaks.length === 0 ? (
          <Empty>Nothing outstanding. Every break raised so far has been resolved.</Empty>
        ) : (
          <Table>
            <thead>
              <tr className="border-border border-b">
                <th className={TH}>Raised</th>
                <th className={TH}>Account</th>
                <th className={TH}>Which way</th>
                <th className={`${TH} text-right`}>By how much</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {breaks.map((item) => (
                <tr key={item.id} className="border-border border-b last:border-0">
                  <td className={`${TD} whitespace-nowrap`}>
                    {dateTime.format(new Date(item.detectedAt))}
                  </td>
                  <td className={TD}>
                    <Code>{item.accountCode}</Code>
                  </td>
                  <td className={TD}>
                    <Tag tone={BREAK_TONE[item.status]}>{BREAK_WORDS[item.kind]}</Tag>
                  </td>
                  <td className={TD_NUM}>
                    <Amount value={item.difference} />
                  </td>
                  <td className={`${TD} text-right`}>
                    <RowLink href={`/admin/reconciliation/breaks/${item.id}`}>open</RowLink>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <Panel title="Sweeps">
        <div className="border-border text-muted-foreground border-b px-4 py-3 text-[13px]">
          {sweeps && !isZeroMicro(sweeps.unswept) ? (
            <>
              <Amount value={sweeps.unswept} className="text-foreground" /> USDT is sitting at
              customer addresses waiting to be swept into the treasury.
            </>
          ) : (
            "Nothing is waiting at a customer address."
          )}
        </div>
        {!sweeps || sweeps.sweeps.length === 0 ? (
          <Empty>No sweeps yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr className="border-border border-b">
                <th className={TH}>Started</th>
                <th className={TH}>From</th>
                <th className={`${TH} text-right`}>Amount</th>
                <th className={TH}>Status</th>
                <th className={TH}>Attempts</th>
              </tr>
            </thead>
            <tbody>
              {sweeps.sweeps.map((sweep) => (
                <tr key={sweep.id} className="border-border border-b last:border-0">
                  <td className={`${TD} whitespace-nowrap`}>
                    {dateTime.format(new Date(sweep.createdAt))}
                  </td>
                  <td className={TD}>
                    <Code>{sweep.address}</Code>
                  </td>
                  <td className={TD_NUM}>
                    <Amount value={sweep.amount} />
                  </td>
                  <td className={TD}>
                    <Tag tone={SWEEP_TONE[sweep.status]}>{sweep.status.toLowerCase()}</Tag>
                    {sweep.lastError ? (
                      <p className="text-muted-foreground mt-1 text-[12px] italic">
                        {sweep.lastError}
                      </p>
                    ) : null}
                  </td>
                  <td className={TD_NUM}>{sweep.attempts}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}

/** One headline number, with the words that say what it counts. */
function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-surface border-border bg-surface border px-4 py-3.5">
      <p className="text-muted-foreground text-[12px]">{label}</p>
      <p className="text-foreground mt-1 text-[17px] font-semibold">
        <Amount value={value} className="text-[17px]" />
      </p>
      {note ? (
        <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">{note}</p>
      ) : null}
    </div>
  );
}
