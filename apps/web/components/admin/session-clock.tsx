"use client";

import { Clock } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { adminActivity, adminClient, type AdminSessionTiming } from "@/lib/admin/client";
import { signInAgain } from "@/lib/next-path";

/*
  An administrator's session ends at a fixed time after signing in, and
  earlier after a stretch without requests (ADMIN_SESSION_* on the API). A
  decision half made when either arrives is a decision lost, so two minutes
  before, this asks. Staying is one request, which moves the idle window. The
  fixed end cannot move, so near it the question becomes "sign in again now,
  and come back to this page".

  The idle window is counted from the last answer the server gave
  (lib/admin/client.ts records it). The server writes its own idle clock at
  most once a minute, so the count here runs a minute short on purpose:
  better asked a minute early than signed out without being asked.
*/

const WARN_MS = 2 * 60_000;
const SLACK_MS = 60_000;
/** setTimeout's longest wait; the fixed end can be a day away. */
const LONGEST_WAIT_MS = 2_147_483_647;

const LOG_IN = "/admin/login";

function here(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** "8 hours", "90 minutes": the idle window as a person says it. */
function spell(minutes: number): string {
  if (minutes % 60 !== 0) return `${minutes} minutes`;
  const hours = minutes / 60;
  return hours === 1 ? "an hour" : `${hours} hours`;
}

export function SessionClock({ timing }: { timing: AdminSessionTiming }) {
  const router = useRouter();
  const lastActivity = useSyncExternalStore(adminActivity.subscribe, adminActivity.last, () => 0);
  const idleEnd = lastActivity + timing.idleMinutes * 60_000 - SLACK_MS;
  const fixedEnd = Date.parse(timing.expiresAt);
  const idle = idleEnd < fixedEnd;
  const end = Math.min(idleEnd, fixedEnd);
  const warnAt = end - WARN_MS;

  // The time, as of the last tick. Only ever set from a timer, never in render.
  const [now, setNow] = useState(0);
  // "Not yet" near the fixed end: hide until it arrives.
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    // Nothing is known until the server has answered once.
    if (lastActivity === 0) return;
    let timer = 0;
    const tick = () => {
      const moment = Date.now();
      setNow(moment);
      if (moment >= end) {
        window.location.replace(signInAgain(LOG_IN, here(), idle ? "idle" : "expired"));
        return;
      }
      // Asleep until the warning is due; then a tick a second for the countdown.
      timer = window.setTimeout(
        tick,
        moment >= warnAt ? 1_000 : Math.min(warnAt - moment, LONGEST_WAIT_MS),
      );
    };
    timer = window.setTimeout(tick, 0);
    return () => window.clearTimeout(timer);
  }, [end, warnAt, idle, lastActivity]);

  if (now === 0 || now < warnAt || now >= end || dismissed === end) return null;

  const left = Math.max(0, Math.ceil((end - now) / 1_000));
  const countdown = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;

  const stay = async () => {
    setBusy(true);
    // Asking who is signed in is a request, and a request moves the idle window.
    const result = await adminClient.me();
    setBusy(false);
    if (!result.ok && result.code === "AUTH") {
      window.location.replace(signInAgain(LOG_IN, here(), "idle"));
    }
  };

  const signInNow = async () => {
    setBusy(true);
    await adminClient.logout();
    window.location.replace(signInAgain(LOG_IN, here()));
  };

  const signOut = async () => {
    setBusy(true);
    await adminClient.logout();
    router.replace(LOG_IN);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="rounded-surface border-border bg-surface shadow-panel w-full max-w-sm border p-5"
      >
        <div className="flex items-center gap-2.5">
          <span className="bg-status-pending text-status-pending-fg flex size-9 items-center justify-center rounded-full">
            <Clock size={18} weight="fill" aria-hidden="true" />
          </span>
          <h2 id={titleId} className="text-foreground text-[17px] font-semibold">
            {idle ? "Still there?" : "Your session is ending"}
          </h2>
        </div>
        <p id={bodyId} className="text-muted-foreground mt-3 text-sm leading-relaxed">
          {idle
            ? `Nothing has come from this session for nearly ${spell(timing.idleMinutes)}, so it signs out in:`
            : "A session lasts a fixed time and cannot be extended. It signs out in:"}
        </p>
        <p className="text-foreground mt-2 font-mono text-3xl font-medium tabular-nums">
          {countdown}
        </p>
        {!idle ? (
          <p className="text-muted-foreground mt-2 text-[13px] leading-relaxed">
            Sign in again now and you come straight back to this page.
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          {idle ? (
            <>
              <Button type="button" autoFocus loading={busy} onClick={() => void stay()}>
                I am still here
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void signOut()}
              >
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Button type="button" autoFocus loading={busy} onClick={() => void signInNow()}>
                Sign in again now
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setDismissed(end)}
              >
                Not yet
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
