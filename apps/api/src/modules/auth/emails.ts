import { type VerificationPurpose } from "@abay/database";

import { type Mail } from "@/infra/mail/mailer";

/*
  The verification-code email, in plain text and HTML. One template for the
  three purposes, differing only in the sentence that says what the code is
  for: a person who gets a login code they did not ask for should be able to
  tell that from a sign-up code they did not ask for.
*/

const PURPOSE_LINE: Record<VerificationPurpose, string> = {
  EMAIL_VERIFICATION: "Use this code to finish creating your account.",
  LOGIN: "Use this code to finish signing in.",
  PASSWORD_RESET: "Use this code to choose a new password.",
};

export function codeEmail(input: {
  to: string;
  purpose: VerificationPurpose;
  code: string;
  appName: string;
  validForMinutes: number;
}): Mail {
  const { to, purpose, code, appName, validForMinutes } = input;
  const line = PURPOSE_LINE[purpose];
  // The code is in the subject so it can be read from a notification without
  // opening the message, which is how most people will use it.
  const subject = `${code} is your ${appName} verification code`;
  const warning = `Never share this code with anyone. ${appName} staff will never ask for it. If you did not request it, you can ignore this email.`;

  const text = [
    line,
    ``,
    `Your verification code: ${code}`,
    ``,
    `It expires in ${validForMinutes} minutes.`,
    ``,
    warning,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f6f4ee;font-family:'IBM Plex Sans',-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#202622">
    <div style="max-width:480px;margin:0 auto;padding:40px 24px">
      <p style="margin:0 0 24px;font-size:18px;font-weight:600;color:#183d32">${escapeHtml(appName)}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5">${escapeHtml(line)}</p>
      <p style="margin:0 0 8px;font-size:13px;color:#5f6a63">Your verification code</p>
      <p style="margin:0 0 24px;font-size:32px;font-weight:600;letter-spacing:0.25em;font-family:'IBM Plex Mono',SFMono-Regular,Menlo,Consolas,monospace;color:#183d32">${code}</p>
      <p style="margin:0 0 24px;font-size:13px;color:#5f6a63">It expires in ${validForMinutes} minutes.</p>
      <p style="margin:0;padding-top:16px;border-top:1px solid #dadfd6;font-size:12px;line-height:1.5;color:#5f6a63">${escapeHtml(warning)}</p>
    </div>
  </body>
</html>`;

  return { to, subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
