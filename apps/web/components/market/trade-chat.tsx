"use client";

import {
  CaretLeft,
  CaretRight,
  Image as ImageIcon,
  LockSimple,
  PaperPlaneRight,
  SealCheck,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { LoadFailed } from "@/components/app/load-failed";
import { useRealtime, useRealtimeEvent } from "@/components/app/realtime-provider";
import { Avatar, TradePill, birr, clockTime, usdt } from "@/components/market/bits";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { pickImage } from "@/lib/image";
import { marketClient, newClientId, type ChatMessage, type Trade } from "@/lib/market/client";
import { traderRecord } from "@/lib/market/labels";
import { chatClosing } from "@/lib/market/orders";
import { presenceLabel } from "@/lib/market/presence";
import { toastFailure } from "@/lib/toast";

/*
  The chat inside an order. Messages are rows the API numbered, in one order
  per trade; the socket only says a new one exists. So the list here is
  built from fetches - everything after the last number it has - and a
  frame that arrives is merged by id, which makes a duplicate harmless and
  a gap (a frame that skipped a number) a reason to fetch again.

  Sending is a POST with a client id minted once per message, so a retry
  over a bad connection is the same message. Reading is reported to the
  server when new words from the other side are on screen and the tab is
  visible, which is what "seen" means to a person - and "on screen" is the
  caller's to say: on a phone the chat is a screen of its own, opened from
  the order, and words in a chat nobody has opened have not been seen.

  Beside the order on a desk. On a phone, Binance's way: full screen, who
  you are talking to on top, a strip that says what the order is waiting for
  and leads back to it, and the message box at the very bottom.

  The chat stays open for a while after the order closes, and says until
  when. Once closed it says why and when instead of offering a box that is
  not there, and stays readable.
*/

const TYPING_SHOWN_MS = 4_000;
const TYPING_SENT_EVERY_MS = 3_000;

function merge(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

export function ChatPanel({
  trade,
  myUserId,
  visible = true,
  fullscreen = false,
  onClose,
}: {
  trade: Trade;
  myUserId: string;
  /** Whether a person can see it: what arrives while they cannot has not been read. */
  visible?: boolean;
  /** The phone's chat: the whole screen, with a way back to the order. */
  fullscreen?: boolean;
  onClose?: (() => void) | undefined;
}) {
  const realtime = useRealtime();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastSeq, setLastSeq] = useState(0);
  const [theirLastReadSeq, setTheirLastReadSeq] = useState(0);
  const [open, setOpen] = useState(trade.actions.canChat);
  const [loaded, setLoaded] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<number | null>(null);
  const lastTypingSent = useRef(0);
  const readReported = useRef(0);
  const tradeId = trade.id;
  const other = trade.counterparty;

  /** Everything after what we have. Used on load, on reconnect, and on a gap. */
  const catchUp = useCallback(
    (after: number) => {
      void marketClient.messages(tradeId, after).then((result) => {
        if (!result.ok) {
          setError((current) => current ?? result.message);
          return;
        }
        setMessages((current) => merge(current, result.messages));
        setLastSeq((current) => Math.max(current, result.lastSeq));
        setTheirLastReadSeq((current) => Math.max(current, result.theirLastReadSeq));
        setOpen(result.open);
        setLoaded(true);
      });
    },
    [tradeId],
  );

  useEffect(() => catchUp(0), [catchUp]);

  useRealtimeEvent("connected", () => catchUp(lastSeq));
  useRealtimeEvent("message", (frame) => {
    if (frame.tradeId !== tradeId) return;
    const { message } = frame;
    setMessages((current) => merge(current, [message]));
    setLastSeq((current) => {
      // A number skipped means something we did not hear about: fetch it.
      if (message.seq > current + 1) catchUp(current);
      return Math.max(current, message.seq);
    });
    if (message.senderId !== myUserId) setTyping(false);
  });
  useRealtimeEvent("read", (frame) => {
    if (frame.tradeId === tradeId && frame.userId !== myUserId) {
      setTheirLastReadSeq((current) => Math.max(current, frame.lastReadSeq));
    }
  });
  useRealtimeEvent("typing", (frame) => {
    if (frame.tradeId !== tradeId || frame.userId === myUserId) return;
    setTyping(true);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => setTyping(false), TYPING_SHOWN_MS);
  });

  // Their newest message on screen, with the tab visible: that is "read".
  useEffect(() => {
    if (!visible) return;
    const newest = messages.filter((message) => message.senderId !== myUserId).at(-1);
    if (!newest || newest.seq <= readReported.current) return;
    const report = () => {
      if (document.visibilityState !== "visible") return;
      readReported.current = newest.seq;
      void marketClient.markRead(tradeId, newest.seq);
    };
    report();
    document.addEventListener("visibilitychange", report);
    return () => document.removeEventListener("visibilitychange", report);
  }, [messages, myUserId, tradeId, visible]);

  // Keep the newest message in view as they arrive, and when the chat is opened.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length, typing, visible]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setError(null);
    setSending(true);
    const result = await marketClient.sendMessage(tradeId, newClientId(), body);
    setSending(false);
    if (!result.ok) {
      setError(result.message);
      toastFailure(result);
      return;
    }
    setDraft("");
    setMessages((current) => merge(current, [result.message]));
    setLastSeq((current) => Math.max(current, result.message.seq));
  };

  const attach = async (file: File | undefined) => {
    if (!file) return;
    setSending(true);
    // A file that cannot be sent is refused, and said so, by pickImage itself.
    const image = await pickImage(file, "chat");
    if (!image) {
      setSending(false);
      return;
    }
    setError(null);
    const result = await marketClient.sendImage(tradeId, newClientId(), image);
    setSending(false);
    if (!result.ok) {
      setError(result.message);
      toastFailure(result);
      return;
    }
    setMessages((current) => merge(current, [result.message]));
    setLastSeq((current) => Math.max(current, result.message.seq));
  };

  const onTyping = () => {
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_SENT_EVERY_MS) return;
    lastTypingSent.current = now;
    realtime.typing(tradeId);
  };

  const lastMine = messages.filter((message) => message.senderId === myUserId).at(-1);
  const presence = presenceLabel(other);
  // The order's word on its own chat; the messages' answer is newer when it differs.
  const closing = chatClosing({ ...trade, actions: { ...trade.actions, canChat: open } });

  return (
    <section
      aria-label="Chat"
      className={cn(
        "flex min-h-0 min-w-0 flex-col",
        fullscreen
          ? "bg-background h-full"
          : "rounded-surface border-border bg-surface shadow-panel h-[min(40rem,calc(100dvh-8rem))] border",
      )}
    >
      <header
        className={cn(
          "border-border flex items-center gap-3 border-b",
          fullscreen ? "bg-background h-14 px-2" : "px-4 py-3.5",
        )}
      >
        {fullscreen ? (
          <button
            type="button"
            aria-label="Back to the order"
            onClick={onClose}
            className="text-foreground rounded-control flex size-10 shrink-0 items-center justify-center"
          >
            <CaretLeft size={20} weight="bold" aria-hidden="true" />
          </button>
        ) : null}
        <Avatar name={other.username} online={other.online} />
        <div className="min-w-0">
          <p className="text-foreground flex items-center gap-1.5 text-[15px] font-semibold">
            <span className="truncate">{other.username}</span>
            {other.verified ? (
              <SealCheck
                size={16}
                weight="fill"
                aria-label="Verified"
                className="text-primary shrink-0"
              />
            ) : null}
          </p>
          <p className="truncate text-[12px] tabular-nums">
            {presence ? (
              <span className={other.online ? "text-online font-medium" : "text-muted-foreground"}>
                {presence}
              </span>
            ) : null}
            <span className="text-muted-foreground">
              {presence ? " · " : ""}
              {traderRecord(other)}
            </span>
          </p>
        </div>
      </header>

      {fullscreen ? (
        <button
          type="button"
          onClick={onClose}
          className="border-border bg-surface rounded-control mx-4 mt-3 flex items-center justify-between gap-3 border px-3 py-2.5 text-left"
        >
          <span className="min-w-0">
            {/* If it must break, between the two figures and never inside one. */}
            <span className="text-foreground block text-[13px] font-semibold tabular-nums">
              <span className="whitespace-nowrap">
                {trade.role === "BUYER" ? "Buy" : "Sell"} {usdt(trade.amount)} ·
              </span>{" "}
              <span className="whitespace-nowrap">{birr(trade.fiatSantim)}</span>
            </span>
            {trade.message ? (
              <span className="text-muted-foreground block text-[12px] leading-snug">
                {trade.message}
              </span>
            ) : null}
          </span>
          <span className="text-muted-foreground flex shrink-0 items-center gap-1.5">
            <TradePill trade={trade} />
            <CaretRight size={14} weight="bold" aria-hidden="true" />
          </span>
        </button>
      ) : null}

      <div
        ref={listRef}
        className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-4"
        aria-live="polite"
        aria-label="Messages"
      >
        {!loaded && error ? (
          <LoadFailed
            message={error}
            onRetry={() => {
              setError(null);
              catchUp(0);
            }}
            className="m-auto"
          />
        ) : !loaded ? (
          <p className="text-muted-foreground m-auto text-[13px]">Loading…</p>
        ) : (
          <>
            <p className="bg-status-neutral text-status-neutral-fg rounded-control max-w-[90%] self-center px-3 py-1.5 text-center text-[12px] leading-snug">
              {trade.status === "DISPUTED"
                ? "A dispute is open. A reviewer can read this chat."
                : "Keep the conversation here. A reviewer can read it if there is a dispute."}
            </p>
            {messages.length === 0 ? (
              <p className="text-muted-foreground m-auto text-center text-[13px]">
                No messages yet. Say when you have paid, or ask about the details.
              </p>
            ) : (
              messages.map((message) => {
                const own = message.senderId === myUserId;
                const last = own && lastMine?.id === message.id;
                return (
                  <div
                    key={message.id}
                    className={cn(
                      "flex max-w-[78%] flex-col gap-0.5",
                      own ? "items-end self-end" : "items-start self-start",
                    )}
                  >
                    <div
                      className={cn(
                        "text-sm leading-snug",
                        message.kind === "IMAGE" ? "p-1" : "px-3 py-2",
                        own
                          ? "bg-primary-soft text-primary-soft-foreground rounded-[12px_12px_4px_12px]"
                          : "bg-muted text-foreground rounded-[12px_12px_12px_4px]",
                      )}
                    >
                      {message.kind === "IMAGE" ? (
                        <a
                          href={marketClient.chatImageUrl(tradeId, message.id)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- bytes come from the API behind the session, not from a public host */}
                          <img
                            src={marketClient.chatImageUrl(tradeId, message.id)}
                            alt="Attached image"
                            className="max-h-64 rounded-lg"
                          />
                        </a>
                      ) : (
                        <span className="break-words whitespace-pre-wrap">{message.body}</span>
                      )}
                    </div>
                    <span className="text-muted-foreground px-1 text-[11px] tabular-nums">
                      {clockTime(message.createdAt)}
                      {last ? (theirLastReadSeq >= message.seq ? " · Seen" : " · Sent") : ""}
                    </span>
                  </div>
                );
              })
            )}
          </>
        )}
      </div>

      {typing ? (
        <p className="text-muted-foreground px-4 pb-2 text-[12px]">{other.username} is typing…</p>
      ) : null}

      {error && loaded ? (
        <p role="alert" className="text-destructive px-4 pb-2 text-[13px]">
          {error}
        </p>
      ) : null}

      {open ? (
        <>
          {closing.line ? (
            <p className="text-muted-foreground px-4 pt-2 text-[12px] leading-snug">
              {closing.line}
            </p>
          ) : null}
          <form
            className={cn(
              "border-border flex items-end gap-2 border-t px-3 pt-3",
              closing.line && "mt-2",
              fullscreen ? "bg-surface pb-[max(0.75rem,env(safe-area-inset-bottom))]" : "pb-3",
            )}
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                void attach(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="secondary"
              size="md"
              aria-label="Send an image"
              className="px-3"
              disabled={sending}
              onClick={() => fileRef.current?.click()}
            >
              <ImageIcon size={18} aria-hidden="true" />
            </Button>
            <textarea
              aria-label="Message"
              rows={1}
              value={draft}
              maxLength={2000}
              placeholder="Write a message"
              onChange={(event) => {
                setDraft(event.target.value);
                onTyping();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              className="rounded-control bg-surface text-foreground border-border focus:border-primary focus:ring-primary/25 max-h-32 min-h-10 flex-1 resize-none border px-3.5 py-2.5 text-[15px] leading-snug focus:ring-2 focus:outline-none"
            />
            <Button
              type="submit"
              size="md"
              aria-label="Send"
              className="px-3"
              loading={sending}
              disabled={!draft.trim()}
            >
              <PaperPlaneRight size={18} weight="fill" aria-hidden="true" />
            </Button>
          </form>
        </>
      ) : (
        <p
          className={cn(
            "border-border bg-muted text-muted-foreground flex items-start gap-2.5 border-t px-4 pt-3.5 text-[13px] leading-relaxed",
            fullscreen
              ? "pb-[max(0.875rem,env(safe-area-inset-bottom))]"
              : "rounded-b-surface pb-3.5",
          )}
        >
          <LockSimple size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            <strong className="text-foreground font-semibold">This chat is closed.</strong>
            {closing.line ? ` ${closing.line}` : ""}
          </span>
        </p>
      )}
    </section>
  );
}
