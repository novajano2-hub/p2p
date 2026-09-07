/**
 * "samlee@gmail.com" -> "sam***@gmail.com". Enough to confirm which inbox to
 * check, not enough to be useful to someone reading over a shoulder.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const keep = Math.min(3, Math.max(1, local.length - 1));
  return `${local.slice(0, keep)}***${domain}`;
}
