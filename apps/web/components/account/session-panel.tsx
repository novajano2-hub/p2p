"use client";

import { SignOut } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthCard, AuthFootnote, AuthLink } from "@/components/auth/auth-card";
import { FormError } from "@/components/auth/notices";
import { Button, ButtonLink } from "@/components/ui/button";
import { authClient, type SessionUser } from "@/lib/auth/client";
import { cta } from "@/lib/site";

/*
  The screen a person lands on once signed in. For now it is a placeholder
  that proves the session exists and lets it be ended; the real home
  (balances, offers, trades) is Phase 2.

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
      <AuthCard title="Home">
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
          <p className="text-muted-foreground text-sm leading-relaxed">Log in to continue.</p>
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

  return (
    <AuthCard title="Home">
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
    </AuthCard>
  );
}
