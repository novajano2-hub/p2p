"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { useNotifications } from "@/components/app/notifications-provider";
import { useRealtimeEvent } from "@/components/app/realtime-provider";
import { useSession } from "@/components/app/session-provider";
import { authClient, type NotificationType } from "@/lib/auth/client";
import { marketClient } from "@/lib/market/client";
import { CHAT_BESIDE, chatAsked, chatLink } from "@/lib/market/orders";
import { toneOf } from "@/lib/notifications";
import { alreadySaid, notificationKey, toast } from "@/lib/toast";

/*
  News, said on whatever page is open. Everything the account is told arrives
  over the socket the moment it is written - a deposit credited, a buyer saying
  they have paid, USDT released, a dispute decided, verification decided - and
  each becomes a toast with a way to go and look. A message in a trade's chat
  becomes one too, unless that chat is on the screen, where it shows the
  message itself: beside the order on a desk, and on a phone only once it has
  been opened over the order.

  The bell keeps the record; this only announces.
*/

/** Long enough for a page that was about to open - the order just placed - to have opened. */
const SETTLE_MS = 1_500;
const PREVIEW_CHARS = 100;

function preview(body: string): string {
  const line = body.replace(/\s+/g, " ").trim();
  return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS - 1)}…` : line;
}

export function LiveToasts() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, updateUser } = useSession();
  const { markRead } = useNotifications();

  // Where the person is when a toast is about to be said, not when its frame was heard.
  const here = useRef(pathname);
  useEffect(() => {
    here.current = pathname;
  }, [pathname]);

  // A counterparty's name, asked for once per trade.
  const names = useRef(new Map<string, Promise<string | null>>());

  useRealtimeEvent("notification", (frame) => {
    const item = { ...frame.notification, type: frame.notification.type as NotificationType };
    // This tab said it already, when its own action came back (the seller's release).
    if (alreadySaid(notificationKey(item.type, item.link))) return;

    // A decision on verification changes what the account may do: take it in now,
    // so posting an ad does not wait for a reload.
    if (item.type === "KYC_APPROVED" || item.type === "KYC_REJECTED") {
      void authClient.me().then((result) => {
        if (result.ok) updateUser(result.user);
      });
    }

    const link = item.link;
    toast.news(toneOf(item.type), item.title, {
      id: `notification:${item.id}`,
      description: item.body,
      action:
        link && here.current !== link
          ? {
              label: "View",
              onClick: () => {
                markRead(item);
                router.push(link);
              },
            }
          : undefined,
    });
  });

  useRealtimeEvent("message", (frame) => {
    const { tradeId, message } = frame;
    if (message.senderId === user.id) return;
    const onScreen = () =>
      here.current === `/orders/${tradeId}` &&
      (window.matchMedia(CHAT_BESIDE).matches ||
        chatAsked(new URLSearchParams(window.location.search)));

    // Heard at the moment an order opens with its advertiser's greeting, before
    // the order's page has replaced the offer's: wait, then look again.
    window.setTimeout(() => {
      if (onScreen()) return;
      let name = names.current.get(tradeId);
      if (!name) {
        name = marketClient
          .trade(tradeId)
          .then((result) => (result.ok ? result.trade.counterparty.username : null));
        names.current.set(tradeId, name);
      }
      void name.then((username) => {
        if (onScreen()) return;
        toast.news("note", username ? `New message from ${username}` : "New message on an order", {
          // One per conversation: a second message replaces the first rather than stacking.
          id: `chat:${tradeId}`,
          description: message.kind === "IMAGE" ? "Sent a picture." : preview(message.body ?? ""),
          action: { label: "Open chat", onClick: () => router.push(chatLink(tradeId)) },
        });
      });
    }, SETTLE_MS);
  });

  return null;
}
