import { formatUsdt } from "@/common/money/units";
import { type Mail } from "@/infra/mail/mailer";

/*
  What a withdrawal tells the customer, through the outbox. Short, and with
  nothing to click: an email about money leaving an account is the most
  impersonated message a platform sends, so this one asks the reader to go
  to the app themselves if something looks wrong.
*/
export function withdrawalMail(input: {
  to: string;
  appName: string;
  amount: bigint;
  destination: string;
  sent: boolean;
}): Mail {
  const amount = `${formatUsdt(input.amount)} USDT`;
  const subject = input.sent ? `${amount} sent` : `${amount} returned to your balance`;
  const body = input.sent
    ? `${amount} has been sent from your ${input.appName} account to ${input.destination}.`
    : `Your withdrawal of ${amount} did not go ahead, and the funds are back in your available balance.`;
  return {
    to: input.to,
    subject,
    text: [body, "", "If this was not you, sign in and change your password straight away."].join(
      "\n",
    ),
    html: [
      `<p>${body}</p>`,
      "<p>If this was not you, sign in and change your password straight away.</p>",
    ].join(""),
  };
}
