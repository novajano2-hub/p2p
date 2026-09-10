"use client";

import { ShieldCheck, SignOut } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { adminClient, type AdminIdentity } from "@/lib/admin/client";

/*
  The chrome around the admin area, and the gate in front of it.

  Visibly not the customer app. That is the point rather than a style choice:
  somebody who can approve identity documents should never be a moment's
  confusion away from thinking they are looking at their own account. Dark
  bar, the realm named in it, and the signed-in administrator always on screen.
*/

const AdminContext = createContext<AdminIdentity | null>(null);

export function useAdmin(): AdminIdentity {
  const admin = useContext(AdminContext);
  if (!admin) throw new Error("useAdmin() must be used inside AdminShell");
  return admin;
}

type State =
  | { status: "loading" }
  | { status: "in"; admin: AdminIdentity }
  | { status: "error"; message: string };

export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let live = true;
    void adminClient.me().then((result) => {
      if (!live) return;
      if (result.ok) {
        setState({ status: "in", admin: result.admin });
        return;
      }
      if (result.code === "AUTH") {
        router.replace("/admin/login");
        return;
      }
      setState({ status: "error", message: result.message });
    });
    return () => {
      live = false;
    };
  }, [router]);

  if (state.status === "loading") {
    return (
      <Frame>
        <p role="status" className="text-muted-foreground text-sm">
          Checking your session&hellip;
        </p>
      </Frame>
    );
  }

  if (state.status === "error") {
    return (
      <Frame>
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      </Frame>
    );
  }

  return (
    <AdminContext.Provider value={state.admin}>
      <div className="flex min-h-full flex-1 flex-col">
        <header className="bg-foreground text-background sticky top-0 z-20">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-5">
            <div className="flex items-center gap-2.5">
              <ShieldCheck size={20} weight="fill" aria-hidden="true" />
              <span className="text-[15px] font-semibold tracking-tight">BIRQ administration</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="hidden text-[13px] opacity-80 sm:inline">{state.admin.email}</span>
              <button
                type="button"
                onClick={async () => {
                  await adminClient.logout();
                  router.replace("/admin/login");
                }}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium underline-offset-4 hover:underline"
              >
                <SignOut size={15} weight="bold" aria-hidden="true" />
                Sign out
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">{children}</main>
      </div>
    </AdminContext.Provider>
  );
}

/** What the gate shows before it knows, centred and without the bar. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-5 py-16">
      <div className="w-full max-w-sm text-center">{children}</div>
    </main>
  );
}

/** Shown where a role is missing, in place of the thing it would have gated. */
export function NeedsRole({ role, children }: { role: string; children?: ReactNode }) {
  return (
    <div className="rounded-surface border-border bg-surface border px-5 py-8 text-center">
      <p className="text-foreground text-sm font-medium">You do not have the {role} role.</p>
      <p className="text-muted-foreground mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed">
        Capability here is granted per task, never by being an administrator. Another administrator
        can grant it with the command line.
      </p>
      {children}
    </div>
  );
}

/** A small button that runs an async action and reports what came back. */
export function ActionButton({
  label,
  busyLabel,
  variant,
  disabled,
  onRun,
}: {
  label: string;
  busyLabel: string;
  variant?: "primary" | "secondary" | "destructive";
  disabled?: boolean;
  onRun: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      size="lg"
      loading={busy}
      disabled={disabled}
      onClick={async () => {
        setBusy(true);
        try {
          await onRun();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? busyLabel : label}
    </Button>
  );
}
