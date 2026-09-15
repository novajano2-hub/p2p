import { AppShell } from "@/components/app/app-shell";
import { RealtimeProvider } from "@/components/app/realtime-provider";
import { SessionProvider } from "@/components/app/session-provider";

/*
  Everything under (app) is behind a session. The provider resolves it once
  and gates rendering on the answer; the socket opens once that answer is
  in, so it never asks for an upgrade the API would refuse; the shell is
  the chrome every signed-in page shares. The shell is a server component
  handed to client providers as children, which is the one direction that
  composition is allowed in.
*/
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <SessionProvider>
      <RealtimeProvider>
        <AppShell>{children}</AppShell>
      </RealtimeProvider>
    </SessionProvider>
  );
}
