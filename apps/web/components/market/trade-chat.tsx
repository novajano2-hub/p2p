"use client";

import { Image as ImageIcon, PaperPlaneRight } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Panel } from "@/components/app/panel";
import { useRealtime, useRealtimeEvent } from "@/components/app/realtime-provider";
import { clockTime } from "@/components/market/bits";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { pickImage } from "@/lib/image";
import { marketClient, newClientId, type ChatMessage, type Trade } from "@/lib/market/client";
import { toastFailure } from "@/lib/toast";

/*
  The chat inside a trade. Messages are rows the API numbered, in one order
  per trade; the socket only says a new one exists. So the list here is
  built from fetches - everything after the last number it has - and a
  frame that arrives is merged by id, which makes a duplicate harmless and
  a gap (a frame that skipped a number) a reason to fetch again.

  Sending is a POST with a client id minted once per message, so a retry
  over a bad connection is the same message. Reading is reported to the
  server when new words from the other side are on screen and the tab is
  visible, which is what "seen" means to a person.
*/

const TYPING_SHOWN_MS = 4_000;
const TYPING_SENT_EVERY_MS = 3_000;

function merge(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

export function ChatPanel({ trade, myUserId }: { trade: Trade; myUserId: string }) {
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
  }, [messages, myUserId, tradeId]);

  // Keep the newest message in view as they arrive.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length, typing]);

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

  const mine = messages.filter((message) => message.senderId === myUserId);
  const lastMine = mine.at(-1);

  return (
    <Panel
      title={trade.counterparty.username}
      description={
        typing
          ? "typing…"
          : open
            ? "Keep the conversation here; a reviewer can read it if there is a dispute."
            : "This chat is closed."
      }
      className="flex flex-col"
    >
      <div
        ref={listRef}
        className="border-border bg-muted/40 rounded-control -mx-1 flex max-h-[28rem] min-h-[16rem] flex-col gap-2 overflow-y-auto border px-3 py-3"
        aria-live="polite"
        aria-label="Messages"
      >
        {!loaded ? (
          <p className="text-muted-foreground m-auto text-[13px]">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-muted-foreground m-auto text-center text-[13px]">
            No messages yet. Say when you have paid, or ask about the details.
          </p>
        ) : (
          messages.map((message) => {
            const own = message.senderId === myUserId;
            const seen = own && lastMine?.id === message.id;
            return (
              <div
                key={message.id}
                className={cn("flex flex-col", own ? "items-end" : "items-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                    own
                      ? "bg-primary-soft text-primary-soft-foreground rounded-br-md"
                      : "bg-surface text-foreground border-border rounded-bl-md border",
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
                <span className="text-muted-foreground mt-0.5 px-1 text-[11px] tabular-nums">
                  {clockTime(message.createdAt)}
                  {seen ? (theirLastReadSeq >= message.seq ? " · Seen" : " · Sent") : ""}
                </span>
              </div>
            );
          })
        )}
      </div>

      {error ? (
        <p role="alert" className="text-destructive mt-2 text-[13px]">
          {error}
        </p>
      ) : null}

      {open ? (
        <form
          className="mt-3 flex items-end gap-2"
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
      ) : null}
    </Panel>
  );
}
