import { formatUsdt } from "@/common/money/units";
import { type Mail } from "@/infra/mail/mailer";

/*
  The email a credited deposit sends, through the outbox. Plain words: the
  amount, where it is now, and nothing that would help a phisher - no link
  to click, no address to verify.
*/
export function depositCreditedEmail(input: { to: string; appName: string; amount: bigint }): Mail {
  const amount = `${formatUsdt(input.amount)} USDT`;
  return {
    to: input.to,
    subject: `${amount} received`,
    text: [
      `${amount} arrived in your ${input.appName} account and is now in your available balance.`,
      "",
      "If you were not expecting this, sign in and check your recent deposits.",
    ].join("\n"),
    html: [
      `<p><strong>${amount}</strong> arrived in your ${input.appName} account and is now in your available balance.</p>`,
      "<p>If you were not expecting this, sign in and check your recent deposits.</p>",
    ].join(""),
  };
}
