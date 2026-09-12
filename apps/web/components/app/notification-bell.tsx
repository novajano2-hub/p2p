"use client";

import { Bell, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { authClient, type NotificationItem } from "@/lib/auth/client";
import { cn } from "@/lib/cn";

/*
  What the account was told without doing anything on this device. A bell
  with a count, the same hand-rolled disclosure pattern as AccountMenu beside
  it: closes on Escape, on a click outside, and on choosing an item.

  Polled rather than pushed - every REFRESH_MS while the tab is open - because
  the only thing that can arrive here today is a KYC decision, which is not
  urgent to the second, and a poll is the whole mechanism rather than a new
  piece of infrastructure. Worth becoming a websocket once something time-
  sensitive (a trade needing a reply) is the thing arriving.
*/

const REFRESH_MS = 45_000;

const ICONS: Record<NotificationItem["type"], typeof CheckCircle> = {
  KYC_APPROVED: CheckCircle,
  KYC_REJECTED: WarningCircle,
  DEPOSIT_CREDITED: CheckCircle,
};

const relativeTime = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });

function timeAgo(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const minutes = Math.round(ms / 60_000);
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeTime.format(hours, "hour");
  return relativeTime.format(Math.round(hours / 24), "day");
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Defined inside the effect, not in render scope: the eslint rule that
  // flags a synchronous setState in an effect cannot see through a function
  // called by reference, only one it can trace into directly.
  useEffect(() => {
    const refresh = async () => {
      const result = await authClient.notifications();
      if (result.ok) {
        setItems(result.notifications);
        setUnreadCount(result.unreadCount);
        setLoaded(true);
      }
    };
    void refresh();
    const id = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const openItem = async (item: NotificationItem) => {
    setOpen(false);
    if (!item.readAt) {
      // Reflected immediately rather than waiting for the next poll: nothing
      // about the unread count should ever look stale right after acting on it.
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry,
        ),
      );
      setUnreadCount((count) => Math.max(0, count - 1));
      void authClient.markNotificationRead(item.id);
    }
    if (item.link) router.push(item.link);
  };

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="rounded-control hover:bg-muted relative flex size-10 items-center justify-center transition-colors duration-150"
      >
        <Bell size={19} weight={unreadCount > 0 ? "fill" : "regular"} aria-hidden="true" />
        {unreadCount > 0 ? (
          <span
            aria-hidden="true"
            className="bg-destructive text-destructive-foreground absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="border-border bg-surface shadow-panel rounded-surface absolute top-full right-0 z-50 mt-2 w-80 border p-2"
      >
        <div className="flex items-center justify-between px-2 pt-1.5 pb-2">
          <p className="text-foreground text-[13px] font-semibold">Notifications</p>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={async () => {
                setItems((current) =>
                  current.map((entry) => ({
                    ...entry,
                    readAt: entry.readAt ?? new Date().toISOString(),
                  })),
                );
                setUnreadCount(0);
                await authClient.markAllNotificationsRead();
              }}
              className="text-primary hover:text-primary-hover text-[12px] font-medium underline-offset-4 hover:underline"
            >
              Mark all read
            </button>
          ) : null}
        </div>

        <div className="max-h-[22rem] overflow-y-auto">
          {!loaded ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-[13px]">
              Loading&hellip;
            </p>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-[13px]">
              Nothing yet. We will let you know when there is something to see.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => {
                const Icon = ICONS[item.type];
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => void openItem(item)}
                      className={cn(
                        "rounded-control hover:bg-muted flex w-full items-start gap-2.5 px-2 py-2.5 text-left transition-colors duration-150",
                        !item.readAt && "bg-primary-soft/40",
                      )}
                    >
                      <Icon
                        size={17}
                        weight="fill"
                        aria-hidden="true"
                        className={cn(
                          "mt-0.5 shrink-0",
                          item.type === "KYC_APPROVED"
                            ? "text-status-complete-fg"
                            : "text-status-attention-fg",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="text-foreground truncate text-[13px] font-medium">
                            {item.title}
                          </span>
                          {!item.readAt ? (
                            <span
                              aria-hidden="true"
                              className="bg-primary size-1.5 shrink-0 rounded-full"
                            />
                          ) : null}
                        </span>
                        <span className="text-muted-foreground mt-0.5 block text-[12px] leading-relaxed">
                          {item.body}
                        </span>
                        <span className="text-muted-foreground mt-1 block text-[11px]">
                          {timeAgo(item.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
