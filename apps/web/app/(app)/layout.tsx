import { AppShell } from "@/components/app/app-shell";
import { SessionProvider } from "@/components/app/session-provider";

/*
  Everything under (app) is behind a session. The provider resolves it once
  and gates rendering on the answer; the shell is the chrome every signed-in
  page shares. The shell is a server component handed to a client provider as
  children, which is the one direction that composition is allowed in.
*/
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <SessionProvider>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
