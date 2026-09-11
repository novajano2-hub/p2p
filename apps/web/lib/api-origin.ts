/*
  Where the browser reaches the API, for both realms.

  Shared because the rule is subtle and getting it wrong fails silently at the
  cookie layer rather than loudly at the network one. Two copies of it would
  drift, and the copy that drifted would be the one nobody tested on a phone.
*/

const CONFIGURED = readApiUrl();

/*
  Loopback names mean "this machine", so they are only correct for a page being
  served from one. Open the dev server by its LAN address to try something on a
  phone and a configured http://localhost:3001 becomes two bugs at once: the
  browser looks for the API on the phone, and the session cookie becomes
  cross-site (localhost and 192.168.x.x are different sites) and is dropped
  with no error anywhere. So when the API is configured under a loopback name
  and the page is not on one, the page's own hostname wins.

  A configured hostname that is not loopback is never touched: in production
  the API deliberately lives on a different host from the page (api.birq.com
  beside birq.com), which is same-site and works as intended.
*/
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function apiOrigin(): string {
  if (typeof window === "undefined") return CONFIGURED;
  const configured = new URL(CONFIGURED);
  const pageHost = window.location.hostname;
  if (pageHost === configured.hostname || !LOOPBACK_HOSTS.has(configured.hostname)) {
    return configured.origin;
  }
  configured.protocol = window.location.protocol;
  configured.hostname = pageHost;
  return configured.origin;
}

function readApiUrl(): string {
  // Inlined at build time. No fallback on purpose: a wrong guess here fails
  // silently at the cookie layer, so a missing value fails loudly instead.
  const value = process.env.NEXT_PUBLIC_API_URL;
  if (!value) {
    throw new Error(
      "NEXT_PUBLIC_API_URL is not set. Copy .env.example to .env at the repository root.",
    );
  }
  return value.replace(/\/+$/, "");
}
