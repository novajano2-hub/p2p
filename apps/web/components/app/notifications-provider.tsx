"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useRealtimeEvent } from "@/components/app/realtime-provider";
import { authClient, type NotificationItem, type NotificationType } from "@/lib/auth/client";

/*
  What the account was told without doing anything on this device, held once
  for the signed-in app. The bell draws it and the live toasts announce it, and
  both mark things read through here - so a notification opened from its toast
  is not still sitting unread in the bell.

  Fed two ways. The socket delivers each notification the moment it is
  written, which is what makes "the buyer says they have paid" arrive while
  the seller is looking at something else. The poll underneath is the
  fallback for a tab whose socket is between reconnects, and the first read
  on load.
*/

const REFRESH_MS = 45_000;
/** As many as the API returns in one list. */
const LIST_LIMIT = 50;

export interface Notifications {
  items: NotificationItem[];
  unreadCount: number;
  loaded: boolean;
  /** Reflected at once rather than on the next poll: a count should never look stale right after acting on it. */
  markRead: (item: NotificationItem) => void;
  markAllRead: () => void;
}

const NotificationsContext = createContext<Notifications | null>(null);

export function useNotifications(): Notifications {
  const notifications = useContext(NotificationsContext);
  if (!notifications)
    throw new Error("useNotifications() must be used under NotificationsProvider");
  return notifications;
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  /*
    The unread ones this tab knows by id, so that marking one read twice - from
    its toast and again from the bell - or hearing one twice over the socket
    moves the count once.
  */
  const unread = useRef(new Set<string>());
  const known = useRef(new Set<string>());

  // Defined inside the effect, not in render scope: the eslint rule that
  // flags a synchronous setState in an effect cannot see through a function
  // called by reference, only one it can trace into directly.
  useEffect(() => {
    const refresh = async () => {
      const result = await authClient.notifications();
      if (!result.ok) return;
      known.current = new Set(result.notifications.map((item) => item.id));
      unread.current = new Set(
        result.notifications.filter((item) => !item.readAt).map((item) => item.id),
      );
      setItems(result.notifications);
      setUnreadCount(result.unreadCount);
      setLoaded(true);
    };
    void refresh();
    const id = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  // The moment it is written, not on the next poll.
  useRealtimeEvent("notification", (frame) => {
    const item = { ...frame.notification, type: frame.notification.type as NotificationType };
    if (known.current.has(item.id)) return;
    known.current.add(item.id);
    setItems((current) => [item, ...current].slice(0, LIST_LIMIT));
    if (!item.readAt) {
      unread.current.add(item.id);
      setUnreadCount((count) => count + 1);
    }
  });

  const markRead = useCallback((item: NotificationItem) => {
    if (!unread.current.delete(item.id)) return;
    const readAt = new Date().toISOString();
    setItems((current) =>
      current.map((entry) => (entry.id === item.id ? { ...entry, readAt } : entry)),
    );
    setUnreadCount((count) => Math.max(0, count - 1));
    void authClient.markNotificationRead(item.id);
  }, []);

  const markAllRead = useCallback(() => {
    unread.current.clear();
    const readAt = new Date().toISOString();
    setItems((current) => current.map((entry) => ({ ...entry, readAt: entry.readAt ?? readAt })));
    setUnreadCount(0);
    void authClient.markAllNotificationsRead();
  }, []);

  return (
    <NotificationsContext.Provider value={{ items, unreadCount, loaded, markRead, markAllRead }}>
      {children}
    </NotificationsContext.Provider>
  );
}
