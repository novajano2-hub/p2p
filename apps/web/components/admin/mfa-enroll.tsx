"use client";

import { LockKey } from "@phosphor-icons/react";
import QRCode from "qrcode";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { CopyButton } from "@/components/app/copy-button";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { adminClient, type AdminIdentity } from "@/lib/admin/client";

/*
  Enrolling the second factor, shown by the shell instead of the admin area
  until it is done - there is no skip, because the API would refuse everything
  else anyway (the guard confines an un-enrolled session to exactly this).

  The secret is fetched when the screen mounts and lives only in this
  component's state: this is the one moment it ever leaves the server, and it
  is gone with the screen. The QR code is drawn locally from it - nothing
  here talks to anything but our own API.
*/

type Stage =
  | { status: "loading" }
  | { status: "ready"; secret: string; qr: string }
  | { status: "failed"; message: string };

export function MfaEnroll({
  email,
  onEnrolled,
}: {
  email: string;
  onEnrolled: (admin: AdminIdentity) => void;
}) {
  const [stage, setStage] = useState<Stage>({ status: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
    Asks the server for the secret once, and hands the answer to whichever
    mount is on screen when it arrives.

    Both halves of that matter, and each is a trap on its own. React runs
    effects twice in development on purpose, to surface effects that are not
    safe to repeat - and this is one, because asking for a secret is a POST
    that changes the server. Firing it twice can leave the screen showing a
    secret the server did not keep, which is the worst kind of bug here: the
    QR scans perfectly and every code is then wrong, with nothing on screen to
    explain why.

    But simply refusing to run a second time is not enough either. React's
    development remount runs the FIRST effect's cleanup before the second
    effect, so a plain "ignore the result if I have been cleaned up" flag
    discards the only response that was ever asked for, and the screen waits
    forever. So the request is kept in a ref as a promise: the first mount
    starts it, every mount awaits the same one, and each only writes state if
    it is still the mount that is showing.

    The server refuses to mint a second secret over a pending one as well, so
    a duplicate request could not do damage anyway - but the right number of
    requests here is one, and this is what makes it one.
  */
  const pending = useRef<Promise<Stage> | null>(null);

  useEffect(() => {
    let live = true;

    pending.current ??= (async (): Promise<Stage> => {
      const result = await adminClient.mfaSetup();
      if (!result.ok) return { status: "failed", message: result.message };
      /*
        Drawn oversized and displayed at half size, so it stays crisp on a
        dense screen. M-level error correction and the library's default
        quiet zone; authenticator cameras are not the demanding kind.
      */
      const qr = await QRCode.toDataURL(result.otpauthUri, { width: 384, margin: 2 });
      return { status: "ready", secret: result.secret, qr };
    })();

    void pending.current.then((next) => {
      if (live) setStage(next);
    });

    return () => {
      live = false;
    };
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (stage.status !== "ready") return;
    setBusy(true);
    setError(null);
    const result = await adminClient.mfaConfirm(code.trim());
    if (result.ok) {
      onEnrolled(result.admin);
      return;
    }
    setBusy(false);
    setError(result.message);
  };

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-16">
      <div className="w-full max-w-[26rem]">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="bg-foreground text-background flex size-9 items-center justify-center rounded-full">
            <LockKey size={18} weight="fill" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-foreground text-[17px] leading-tight font-semibold">
              Set up two-factor authentication
            </h1>
            <p className="text-muted-foreground text-[12px]">
              Required before {email} can do anything else here.
            </p>
          </div>
        </div>

        <div className="rounded-surface border-border bg-surface shadow-panel flex flex-col gap-5 border px-5 py-6">
          {stage.status === "loading" ? (
            <p role="status" className="text-muted-foreground text-sm">
              Preparing your secret&hellip;
            </p>
          ) : null}

          {stage.status === "failed" ? (
            <p role="alert" className="text-destructive text-sm leading-relaxed">
              {stage.message}
            </p>
          ) : null}

          {stage.status === "ready" ? (
            <>
              <ol className="text-muted-foreground list-decimal space-y-1.5 pl-4 text-[13px] leading-relaxed">
                <li>Open an authenticator app: Google Authenticator, 1Password, Authy.</li>
                <li>Scan the code, or type the key in by hand.</li>
                <li>Enter the 6 digits the app shows to prove it worked.</li>
              </ol>

              {/* Its own white ground, deliberately theme-proof: a QR code on a
                  dark surface scans badly, whatever the app. */}
              <div className="flex justify-center">
                <div className="rounded-surface border-border border bg-white p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL, not an asset to optimise */}
                  <img
                    src={stage.qr}
                    alt="QR code for your authenticator app"
                    width={192}
                    height={192}
                  />
                </div>
              </div>

              <div>
                <p className="text-muted-foreground mb-1 text-[12px]">
                  Or enter this key manually:
                </p>
                <p className="text-foreground flex items-center gap-1.5 font-mono text-[13px] break-all">
                  {stage.secret}
                  <CopyButton value={stage.secret} label="Copy the key" />
                </p>
              </div>

              <form
                onSubmit={(event) => void onSubmit(event)}
                noValidate
                className="flex flex-col gap-4"
              >
                {error ? (
                  <p
                    role="alert"
                    className="rounded-control border-destructive/30 bg-status-attention text-status-attention-fg border px-3.5 py-3 text-[13px] leading-relaxed"
                  >
                    {error}
                  </p>
                ) : null}
                <Field label="Code from the app">
                  {(a11y) => (
                    <Input
                      {...a11y}
                      value={code}
                      onChange={(event) =>
                        setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      spellCheck={false}
                    />
                  )}
                </Field>
                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  loading={busy}
                  disabled={code.length !== 6}
                >
                  Turn on two-factor authentication
                </Button>
              </form>
            </>
          ) : null}
        </div>

        <p className="text-muted-foreground mt-5 text-center text-[12px] leading-relaxed">
          Lost phone later? Another administrator resets you from the command line. There is no
          online recovery, on purpose.
        </p>
      </div>
    </main>
  );
}
