"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { announceSessionEnded } from "@/lib/auth/client";
import {
  RealtimeClient,
  realtimeUrl,
  type ConnectionState,
  type FrameOf,
  type RealtimeEvent,
  type ServerFrame,
} from "@/lib/realtime/client";

/*
  One socket for the signed-in app, opened once the session is known (this
  sits under SessionProvider) and closed when the app is left. Screens do
  not touch the socket; they subscribe to a trade for as long as they are
  showing it, and listen for the frames they care about.

  If the server says the session has ended (4001), that is the same news a
  401 brings, and it is handled the same way: SessionProvider sends the person
  to log in, and back here afterwards. Too many tabs (4002) only stands this
  one down; the connection banner says so and offers a reload.
*/

const RealtimeContext = createContext<RealtimeClient | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new RealtimeClient(realtimeUrl()));

  useEffect(() => {
    client.connect();
    const stop = client.on("disconnected", () => {
      if (client.state === "ended") announceSessionEnded();
    });
    return () => {
      stop();
      client.close();
    };
  }, [client]);

  return <RealtimeContext.Provider value={client}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeClient {
  const client = useContext(RealtimeContext);
  if (!client) throw new Error("useRealtime() must be used under RealtimeProvider");
  return client;
}

/** What a handler for an event receives: the frame, or nothing for the connection events. */
type Payload<T extends RealtimeEvent> = T extends ServerFrame["type"] ? FrameOf<T> : undefined;

/**
 * Hears one kind of frame for as long as the component is mounted. The
 * handler is read through a ref so a fresh closure on every render does
 * not re-register the listener on every render.
 */
export function useRealtimeEvent<T extends RealtimeEvent>(
  type: T,
  handler: (payload: Payload<T>) => void,
): void {
  const client = useRealtime();
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    return client.on(type, (frame) => {
      latest.current(frame as Payload<T>);
    });
  }, [client, type]);
}

/** How the live connection is doing, for the banner that says so. */
export function useConnectionState(): ConnectionState {
  const client = useRealtime();
  return useSyncExternalStore(
    (listener) => client.subscribeState(listener),
    () => client.state,
    () => "connecting",
  );
}

/** Watches a trade while the component that shows it is mounted. */
export function useTradeSubscription(tradeId: string | null): void {
  const client = useRealtime();
  useEffect(() => {
    if (!tradeId) return;
    return client.subscribe(tradeId);
  }, [client, tradeId]);
}
