"use client";

import { ConnectionBanner } from "@/components/app/connection-banner";
import { useConnectionState } from "@/components/app/realtime-provider";

/*
  The connection banner for the signed-in app, which has a live connection
  to report on as well as the browser's own. Its own file so the admin
  realm, which has no socket, never imports the realtime client to get the
  offline line.
*/
export function LiveConnectionBanner() {
  const live = useConnectionState();
  return <ConnectionBanner live={live} className="top-16" />;
}
