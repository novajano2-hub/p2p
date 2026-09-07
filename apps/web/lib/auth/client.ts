/*
  The auth client the sign-in and sign-up pages talk to.

  Today it is a PREVIEW. There is no account service yet (that is Phase 1), so
  this implementation lets every step of a flow be walked and then fails the
  final action of each flow with NOT_CONNECTED, which the pages render as a
  real inline error. Nothing is stored, nothing is sent.

  The rule is simple and the pages rely on it:
    - intermediate steps (start, verify code, resend) resolve ok
    - final actions (create account, log in, reset, Google) return NOT_CONNECTED

  Phase 1 swaps `authClient` for an implementation that calls the API behind
  this same interface. The pages do not change. The preview notice the pages
  show is driven by `mode`, so it disappears on its own.
*/

export type AuthErrorCode =
  "NOT_CONNECTED" | "INVALID_CREDENTIALS" | "INVALID_CODE" | "RATE_LIMITED";

export type AuthResult = { ok: true } | { ok: false; code: AuthErrorCode; message: string };

export interface AuthClient {
  readonly mode: "preview" | "live";
  startRegistration(input: { email: string }): Promise<AuthResult>;
  verifyEmailCode(input: { email: string; code: string }): Promise<AuthResult>;
  resendEmailCode(input: { email: string }): Promise<AuthResult>;
  completeRegistration(input: { email: string; password: string }): Promise<AuthResult>;
  startLogin(input: { email: string }): Promise<AuthResult>;
  login(input: { email: string; password: string }): Promise<AuthResult>;
  requestPasswordReset(input: { email: string }): Promise<AuthResult>;
  continueWithGoogle(): Promise<AuthResult>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const ok: AuthResult = { ok: true };

const notConnected: AuthResult = {
  ok: false,
  code: "NOT_CONNECTED",
  message: "Accounts are not connected yet. This screen is a preview and nothing was saved.",
};

export const previewAuthClient: AuthClient = {
  mode: "preview",
  async startRegistration() {
    await wait(500);
    return ok;
  },
  async verifyEmailCode() {
    await wait(500);
    return ok;
  },
  async resendEmailCode() {
    await wait(400);
    return ok;
  },
  async completeRegistration() {
    await wait(700);
    return notConnected;
  },
  async startLogin() {
    await wait(400);
    return ok;
  },
  async login() {
    await wait(700);
    return notConnected;
  },
  async requestPasswordReset() {
    await wait(600);
    return notConnected;
  },
  async continueWithGoogle() {
    await wait(400);
    return notConnected;
  },
};

export const authClient: AuthClient = previewAuthClient;
