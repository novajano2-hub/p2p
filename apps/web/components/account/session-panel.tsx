"use client";

import { SignOut } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { AuthCard } from "@/components/auth/auth-card";
import { FormError } from "@/components/auth/notices";
import { Button, ButtonLink } from "@/components/ui/button";
import { authClient, type SessionUser } from "@/lib/auth/client";
import { cta } from "@/lib/site";

/*
  The screen a person lands on once signed in. For now it is a placeholder that
  proves the session exists and lets it be ended; the real home (balances,
  offers, trades) is Phase 2.

  There is no signed-out state here. Being signed out is not something this
  screen has to say - it is a reason to be somewhere else, so it leaves for the
  landing page. Middleware already turns away anyone arriving without a cookie
  at all; what is left for this component is the case the cookie cannot answer,
  where the cookie is present but the session behind it is gone.

  It resolves the session on the client rather than on the server because the
  session cookie belongs to the API's host, not to this app's server. A server
  component here would have to forward the cookie itself, which is the wiring
  for a Next-side BFF; nothing yet needs that.
*/

type State =
  | { status: "loading" }
  | { status: "signed-in"; user: SessionUser }
  | { status: "error"; message: string };

/*
  Leaves for the landing page with a full document load rather than a client-side
  navigation. Two reasons, and the first one is a bug if ignored: middleware
  routes on the session cookie, and Next caches prefetched routes with whatever
  middleware decided at prefetch time. While signed in, a prefetch of / resolves
  to /account, so a soft navigation there after signing out replays that cached
  redirect and lands straight back on this page. (Prefetching is off in
  development and on in a production build, so this only shows up in the built
  app.) The second reason is worth having anyway: a reload drops every cached
  RSC payload belonging to the session that just ended.
*/
function leaveForLandingPage(): void {
  window.location.replace("/");
}

export function SessionPanel() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  useEffect(() => {
    // Guards against a state write after the panel is gone.
    let live = true;

    void (async () => {
      const result = await authClient.me();
      if (!live) return;

      if (result.ok) {
        setState({ status: "signed-in", user: result.user });
        return;
      }

      if (result.code === "INVALID_CREDENTIALS") {
        // Signed out. The cookie outlived the session behind it, so it has to
        // be cleared before leaving: middleware reads that cookie, and would
        // send the landing page straight back here.
        const cleared = await authClient.logout();
        if (!live) return;
        if (cleared.ok) {
          leaveForLandingPage();
          return;
        }
        // Redirecting with the cookie still in place would bounce between the
        // two pages, so this stops and says what happened instead.
        setState({ status: "error", message: cleared.message });
        return;
      }

      setState({ status: "error", message: result.message });
    })();

    return () => {
      live = false;
    };
  }, [attempt]);

  if (state.status === "loading") {
    return (
      <AuthCard title="Home">
        <p className="text-muted-foreground text-sm" role="status">
          Checking your session…
        </p>
      </AuthCard>
    );
  }

  if (state.status === "error") {
    return (
      <AuthCard title="Something went wrong">
        <FormError message={state.message} />
        <p className="text-muted-foreground text-sm leading-relaxed">
          We could not check whether you are signed in.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </Button>
          <ButtonLink
            href={cta.login.href}
            variant="secondary"
            size="lg"
            className="w-full"
            arrow={false}
          >
            {cta.login.label}
          </ButtonLink>
        </div>
      </AuthCard>
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
          setSignOutError(null);
          const result = await authClient.logout();
          if (!result.ok) {
            // Never claim to have signed someone out when the server still
            // holds a live session. On a shared computer that lie is the whole
            // risk, so the screen says what is actually true.
            setSigningOut(false);
            setSignOutError(result.message);
            return;
          }
          // Stays busy through the navigation: the cookie is gone, so the
          // landing page is where this person now belongs.
          leaveForLandingPage();
        }}
      >
        <SignOut size={18} weight="bold" aria-hidden="true" />
        Log out
      </Button>
    </AuthCard>
  );
}
