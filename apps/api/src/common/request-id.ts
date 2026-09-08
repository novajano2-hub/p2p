import { v7 as uuidv7 } from "uuid";

/*
  Every request gets an id that appears in the response header, the log line
  and any error body, so one string ties a support ticket to a log entry.

  A client may supply its own (a trace id from the web app or a load balancer)
  and it is honoured only if it is plainly safe to print: no whitespace, no
  control characters, bounded length. Anything else is replaced, so a header
  can never inject into a log line.
*/
const SAFE_ID = /^[A-Za-z0-9._-]{8,128}$/;

export function requestIdFrom(header: unknown): string {
  return typeof header === "string" && SAFE_ID.test(header) ? header : uuidv7();
}
