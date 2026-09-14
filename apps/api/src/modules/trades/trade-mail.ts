import { formatEtb } from "@/common/money/fiat";
import { formatUsdt } from "@/common/money/units";
import { type Mail } from "@/infra/mail/mailer";

/*
  What a trade tells a party by email, through the outbox. Short, and with
  nothing to click: a message about a trade is exactly what a phisher would
  imitate, so every one of these says to open the app yourself.

  The counterparty is named by username only. An email never carries the
  other side's account number, phone or anything else from the payment
  instructions; those live in the app, behind the session.
*/

export type TradeMailKind = "OPENED" | "PAID" | "RELEASED" | "CANCELLED" | "EXPIRED";

export function tradeMail(
  kind: TradeMailKind,
  input: {
    to: string;
    appName: string;
    /** Whether the recipient is buying or selling in this trade. */
    role: "BUYER" | "SELLER";
    amount: bigint;
    fiatSantim: bigint;
    counterparty: string;
  },
): Mail {
  const usdt = `${formatUsdt(input.amount)} USDT`;
  const birr = `${formatEtb(input.fiatSantim)} birr`;
  const other = input.counterparty;

  let subject: string;
  let body: string;
  switch (kind) {
    case "OPENED":
      subject =
        input.role === "SELLER"
          ? `${other} is buying ${usdt} from you`
          : `${other} is selling you ${usdt}`;
      body =
        input.role === "SELLER"
          ? `${other} has opened a trade for ${usdt} at ${birr}. Your USDT is held in escrow until you confirm the birr has arrived - do not release before it has.`
          : `${other} has opened a trade to sell you ${usdt} for ${birr}. Their USDT is held in escrow. Pay them with the details shown in the app, then mark the trade as paid.`;
      break;
    case "PAID":
      subject = `${other} says they have paid ${birr}`;
      body = `${other} has marked their trade for ${usdt} as paid. Check that ${birr} has actually arrived in your account, and only then release the USDT in the app.`;
      break;
    case "RELEASED":
      subject = `${usdt} is in your balance`;
      body = `${other} has released ${usdt} to you. It is in your available balance now.`;
      break;
    case "CANCELLED":
      subject = `Trade for ${usdt} cancelled`;
      body = `${other} cancelled their trade for ${usdt}. Your USDT is back in your available balance. If you have already received birr for it, contact them in the app.`;
      break;
    case "EXPIRED":
      subject = `Trade for ${usdt} expired`;
      body =
        input.role === "SELLER"
          ? `The trade with ${other} for ${usdt} expired before they paid. Your USDT is back in your available balance.`
          : `Your trade with ${other} for ${usdt} expired before it was marked as paid. Do not send anything for it now; if you already have, contact them in the app.`;
      break;
  }

  const footer = `Open ${input.appName} to see the trade. Never follow a link in an email to release or pay.`;
  return {
    to: input.to,
    subject,
    text: [body, "", footer].join("\n"),
    html: [`<p>${body}</p>`, `<p>${footer}</p>`].join(""),
  };
}
