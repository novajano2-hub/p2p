"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { AuthCard } from "@/components/auth/auth-card";
import { FormError } from "@/components/auth/notices";
import { Button, ButtonLink } from "@/components/ui/button";
import { authClient, onSessionEnded, type AuthResult, type SessionUser } from "@/lib/auth/client";
import { signInAgain, takeStashedNext } from "@/lib/next-path";
import { afterAuth, cta } from "@/lib/site";

/*
  The gate on the signed-in app, and the one place the session is resolved.
  Everything under (app) renders only once /v1/auth/me has answered, and reads
  the answer through useSession() rather than asking again.

  There is no signed-out state here. Being signed out is not something a
  screen has to say; it is a reason to be somewhere else. proxy.ts already
  sends anyone arriving without a cookie to the log-in page; what is left for
  this component is the case the cookie cannot answer, where the cookie is
  present but the session behind it is gone - found on arrival, or later, by
  any request a screen makes (lib/auth/client.ts announces it) or by the
  socket. Either way the person is sent to log in with ?next= set to where
  they were, and comes straight back to it.

  The session is resolved on the client rather than on the server because the
  cookie belongs to the API's host, not to this app's server. A server
  component here would have to forward the cookie itself, which is the wiring
  for a Next-side BFF; nothing yet needs that.
*/

export interface Session {
  user: SessionUser;
  /** Ends the session and leaves for the landing page. Resolves with the failure if it could not. */
  signOut: () => Promise<AuthResult>;
  /** Replaces the user after a profile change, so every screen shows the new value at once. */
  updateUser: (user: SessionUser) => void;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession() must be used under SessionProvider");
  return session;
}

type State =
  | { status: "loading" }
  | { status: "signed-in"; user: SessionUser }
  | { status: "error"; message: string };

/*
  A full document load rather than a client-side navigation, for two reasons.
  The first is a bug if ignored: proxy.ts routes on the session cookie, and
  Next caches prefetched routes with whatever the proxy decided at prefetch
  time. While signed in, a prefetch of / resolves to /account, so a soft
  navigation there after signing out replays that cached redirect and lands
  straight back in the app. (Prefetching is off in development and on in a
  production build, so this only shows up in the built app.) The second is
  worth having anyway: a reload drops every cached payload belonging to the
  session that just ended.
*/
function leaveForLandingPage(): void {
  window.location.replace("/");
}

/*
  The session behind this tab has ended. The cookie goes first - the proxy
  routes on it, and a stale one would send /account straight back here - and
  if even that fails, the log-in page is reachable with it in the jar anyway.
  Once only: every screen's requests fail together when a session ends.
*/
let leaving = false;
async function leaveToSignIn(): Promise<void> {
  if (leaving) return;
  leaving = true;
  await authClient.logout();
  const here = `${window.location.pathname}${window.location.search}`;
  window.location.replace(signInAgain(cta.login.href, here, "ended"));
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  // Any request, from any screen, that finds the session gone.
  useEffect(() => onSessionEnded(() => void leaveToSignIn()), []);

  useEffect(() => {
    // Guards against a state write after the provider is gone.
    let live = true;

    void (async () => {
      const result = await authClient.me();
      if (!live) return;

      if (result.ok) {
        setState({ status: "signed-in", user: result.user });
        // Back from Google, which always lands here: go where the log-in page was sent from.
        const pending = window.location.pathname === afterAuth ? takeStashedNext() : null;
        if (pending && pending !== afterAuth) router.replace(pending);
        return;
      }

      // The cookie outlived the session behind it: the listener above is already leaving.
      if (result.code === "SESSION_ENDED") return;

      setState({ status: "error", message: result.message });
    })();

    return () => {
      live = false;
    };
  }, [attempt, router]);

  if (state.status === "loading") {
    return (
      <Gate>
        <AuthCard title="Home">
          <p className="text-muted-foreground text-sm" role="status">
            Checking your session…
          </p>
        </AuthCard>
      </Gate>
    );
  }

  if (state.status === "error") {
    return (
      <Gate>
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
      </Gate>
    );
  }

  const session: Session = {
    user: state.user,
    updateUser: (user) => setState({ status: "signed-in", user }),
    signOut: async () => {
      const result = await authClient.logout();
      // Never claim to have signed someone out when the server still holds a
      // live session. On a shared computer that lie is the whole risk.
      if (result.ok) leaveForLandingPage();
      return result;
    },
  };

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/** The centred card layout the gate states use, before the app shell exists. */
function Gate({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-5 py-10 sm:py-16">
      <div className="w-full max-w-[27rem]">{children}</div>
    </main>
  );
}
