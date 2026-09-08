"use client";

import { CheckCircle, SignOut } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { AuthCard, AuthFootnote, AuthLink } from "@/components/auth/auth-card";
import { FormError } from "@/components/auth/notices";
import { Button, ButtonLink } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { authClient, type SessionUser } from "@/lib/auth/client";
import { cta } from "@/lib/site";

/*
  The first authenticated screen. It exists to make the session visible and
  endable: it asks the API who the cookie belongs to, shows the answer, and
  signs out. The real account area (balances, trades, settings) is Phase 2.

  It resolves the session on the client rather than on the server because the
  session cookie belongs to the API's host, not to this app's server. A server
  component here would have to forward the cookie itself, which is the wiring
  for a Next-side BFF; nothing yet needs that.
*/

type State =
  | { status: "loading" }
  | { status: "signed-in"; user: SessionUser }
  | { status: "signed-out" }
  | { status: "error"; message: string };

export function SessionPanel() {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  useEffect(() => {
    // Guards against a state write after the panel is gone.
    let live = true;
    void authClient.me().then((result) => {
      if (!live) return;
      if (result.ok) setState({ status: "signed-in", user: result.user });
      // A 401 is the ordinary signed-out answer, not a failure worth alarming
      // anyone about. Anything else is a real problem and says so.
      else if (result.code === "INVALID_CREDENTIALS") setState({ status: "signed-out" });
      else setState({ status: "error", message: result.message });
    });
    return () => {
      live = false;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <AuthCard title="Your account">
        <p className="text-muted-foreground text-sm" role="status">
          Checking your session…
        </p>
      </AuthCard>
    );
  }

  if (state.status === "signed-out" || state.status === "error") {
    return (
      <>
        <AuthCard title="You are signed out">
          {state.status === "error" ? <FormError message={state.message} /> : null}
          <p className="text-muted-foreground text-sm leading-relaxed">
            Log in to see your account.
          </p>
          <div className="mt-6">
            <ButtonLink href={cta.login.href} size="lg" className="w-full" arrow={false}>
              {cta.login.label}
            </ButtonLink>
          </div>
        </AuthCard>
        <AuthFootnote>
          New here? <AuthLink href={cta.signup.href}>{cta.signup.label}</AuthLink>
        </AuthFootnote>
      </>
    );
  }

  const { user } = state;

  return (
    <>
      <AuthCard title="Your account" description="Signed in. Nothing to trade with yet.">
        <dl className="divide-border border-border divide-y border-y text-sm">
          <Row label="Email">
            <span className="text-foreground break-all">{user.email}</span>
          </Row>
          <Row label="Email verified">
            {user.emailVerified ? (
              <StatusPill status="complete">Verified</StatusPill>
            ) : (
              <StatusPill status="pending">Not verified</StatusPill>
            )}
          </Row>
          <Row label="Status">
            <StatusPill status={user.status === "ACTIVE" ? "complete" : "attention"}>
              {user.status.charAt(0) + user.status.slice(1).toLowerCase()}
            </StatusPill>
          </Row>
          <Row label="Account ID">
            {/* Mono, because it is an identifier a support ticket may quote. */}
            <span className="text-muted-foreground font-mono text-xs break-all">{user.id}</span>
          </Row>
        </dl>

        <p className="text-muted-foreground mt-6 flex items-start gap-2 text-[13px] leading-relaxed">
          <CheckCircle size={16} weight="fill" className="text-primary mt-0.5 shrink-0" />
          <span>
            Your session lives in an HttpOnly cookie, so no script on this page can read it. Signing
            out revokes it on the server, not just in this browser.
          </span>
        </p>

        <div className="mt-6">
          <FormError message={signOutError} />
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="w-full"
            loading={signingOut}
            onClick={async () => {
              setSigningOut(true);
              const result = await authClient.logout();
              setSigningOut(false);
              if (!result.ok) {
                // Never claim to have signed someone out when the server still
                // holds a live session. On a shared computer that lie is the
                // whole risk, so the screen says what is actually true.
                setSignOutError(result.message);
                return;
              }
              setSignOutError(null);
              setState({ status: "signed-out" });
              router.refresh();
            }}
          >
            <SignOut size={18} weight="bold" aria-hidden="true" />
            Log out
          </Button>
        </div>
      </AuthCard>
      <AuthFootnote>
        <AuthLink href="/">Back to the home page</AuthLink>
      </AuthFootnote>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
