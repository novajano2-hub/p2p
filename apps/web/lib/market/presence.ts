/*
  The words beside the dot. The server decides who is online - seen in the
  last five minutes (PresenceService) - and this only says how long ago the
  rest were seen, the way Binance does: minutes, then hours, then days, then
  the date. A name with no record of it says nothing rather than guess.
*/

export type Presence = { online: boolean; lastSeenAt: string | null };

const MINUTE = 60_000;
const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

export function presenceLabel(presence: Presence, now: number = Date.now()): string | null {
  if (presence.online) return "Online";
  if (!presence.lastSeenAt) return null;
  const seen = Date.parse(presence.lastSeenAt);
  if (Number.isNaN(seen)) return null;
  const minutes = Math.max(1, Math.floor((now - seen) / MINUTE));
  if (minutes < 60) return `Last online ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last online ${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Last online ${days} ${days === 1 ? "day" : "days"} ago`;
  return `Last online on ${day.format(new Date(seen))}`;
}
