import { endsSession } from "@/lib/auth/session-paths";

/*
  A 401 is two different things depending on where it came from: on a
  signed-in screen the session is over, and the app sends the person to log
  in and back; on the log-in form it is a wrong password, and must stay on
  the form. Getting this backwards either signs people out for a typo or
  leaves a dead session's screens refusing everything with no way out.
*/

describe("a 401 that ends the session", () => {
  it("is any signed-in request", () => {
    for (const path of [
      "/v1/auth/me",
      "/v1/trades",
      "/v1/trades/t1/paid",
      "/v1/offers/mine",
      "/v1/wallet/withdrawals",
      "/v1/notifications",
      "/v1/kyc/documents/front",
    ]) {
      expect(endsSession(path)).toBe(true);
    }
  });

  it("is not an answer from signing in, or from signing out", () => {
    for (const path of [
      "/v1/auth/login",
      "/v1/auth/login/verify",
      "/v1/auth/login/resend",
      "/v1/auth/register/start",
      "/v1/auth/register/complete",
      "/v1/auth/password-reset",
      "/v1/auth/password-reset/verify",
      "/v1/auth/logout",
    ]) {
      expect(endsSession(path)).toBe(false);
    }
  });

  it("is not fooled by a path that only starts like a sign-in one", () => {
    expect(endsSession("/v1/auth/logins")).toBe(true);
    expect(endsSession("/v1/auth/registered-devices")).toBe(true);
  });
});
