"use client";

import {
  ArrowCircleDown,
  ArrowCircleUp,
  Bell,
  ChatCircleDots,
  CheckCircle,
  EyeSlash,
  Handshake,
  PauseCircle,
  Scales,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { useNotifications } from "@/components/app/notifications-provider";
import type { NotificationItem, NotificationType } from "@/lib/auth/client";
import { cn } from "@/lib/cn";
import { toneOf } from "@/lib/notifications";

/*
  What the account was told without doing anything on this device. A bell
  with a count, the same hand-rolled disclosure pattern as AccountMenu beside
  it: closes on Escape, on a click outside, and on choosing an item. The list
  itself is NotificationsProvider's, shared with the toasts that announce each
  one as it arrives.
*/

const ICONS: Partial<Record<NotificationType, typeof CheckCircle>> = {
  KYC_APPROVED: CheckCircle,
  KYC_REJECTED: WarningCircle,
  DEPOSIT_CREDITED: ArrowCircleDown,
  WITHDRAWAL_SENT: ArrowCircleUp,
  WITHDRAWAL_RETURNED: WarningCircle,
  TRADE_OPENED: Handshake,
  TRADE_PAID: ChatCircleDots,
  TRADE_RELEASED: CheckCircle,
  TRADE_CANCELLED: XCircle,
  TRADE_EXPIRED: XCircle,
  DISPUTE_OPENED: Scales,
  DISPUTE_WITHDRAWN: Scales,
  DISPUTE_RESOLVED: Scales,
  OFFER_HIDDEN: EyeSlash,
  OFFER_PAUSED: PauseCircle,
};

const TONE_CLASS = {
  good: "text-status-complete-fg",
  warn: "text-status-attention-fg",
  note: "text-primary",
} as const;

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
  const { items, unreadCount, loaded, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const panelId = useId();

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

  const openItem = (item: NotificationItem) => {
    setOpen(false);
    markRead(item);
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

      {/*
        On a phone the list spans the screen under the header, 16px in from
        each edge: hung from the bell, which is not the rightmost thing in the
        header, 320px ran off the left of a 360px screen. `fixed` places it by
        the header's box - its backdrop blur makes that the containing block -
        which is the screen's width at the top.
      */}
      <div
        id={panelId}
        hidden={!open}
        className="border-border bg-surface shadow-panel rounded-surface fixed inset-x-4 top-[4.5rem] z-50 border p-2 sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-80"
      >
        <div className="flex items-center justify-between px-2 pt-1.5 pb-2">
          <p className="text-foreground text-[13px] font-semibold">Notifications</p>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={markAllRead}
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
                const Icon = ICONS[item.type] ?? Bell;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className={cn(
                        "rounded-control hover:bg-muted flex w-full items-start gap-2.5 px-2 py-2.5 text-left transition-colors duration-150",
                        !item.readAt && "bg-primary-soft/40",
                      )}
                    >
                      <Icon
                        size={17}
                        weight="fill"
                        aria-hidden="true"
                        className={cn("mt-0.5 shrink-0", TONE_CLASS[toneOf(item.type)])}
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
