import { createHash } from "node:crypto";

import { type GoogleFailure } from "@abay/contracts";
import { type User } from "@abay/database";
import { Inject, Injectable } from "@nestjs/common";
import { type FastifyReply } from "fastify";
import { PinoLogger } from "nestjs-pino";
import { z } from "zod";

import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { RedisService } from "@/infra/redis/redis.service";
import {
  generatePlatformId,
  placeholderUsername,
  uniqueViolationTargets,
  usernameKey,
} from "@/modules/auth/platform-id";
import { SessionService } from "@/modules/auth/session.service";
import { generateToken, hashToken } from "@/modules/auth/tokens";

/*
  Sign in with Google, as the server-side authorization-code flow with PKCE.

  The browser is sent to Google and comes back to this API with a one-time
  code; this API exchanges it for an ID token using the client secret, which
  therefore never leaves the server. No Google script runs in the page, no
  token is ever handed to the browser, and the session comes back the same
  way as every other: an httpOnly cookie set on a redirect.

  State, the PKCE verifier and the nonce live in Redis for ten minutes under
  a hash of the state value, so a callback that was not started here, or that
  is replayed, has nothing to match.
*/

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const STATE_TTL_SECONDS = 10 * 60;
const TIMEOUT_MS = 10_000;
/** Draws of the eight-digit account number before giving up. */
const ID_ATTEMPTS = 5;

export class GoogleSignInError extends Error {
  constructor(readonly reason: GoogleFailure) {
    super(`google sign-in: ${reason}`);
    this.name = "GoogleSignInError";
  }
}

const pending = z.object({ verifier: z.string(), nonce: z.string() });

const tokenResponse = z.object({ id_token: z.string().min(1) });

/** The claims this API relies on. Anything else Google sends is ignored. */
const idTokenClaims = z.object({
  iss: z.string(),
  aud: z.string(),
  exp: z.number(),
  nonce: z.string().optional(),
  sub: z.string().min(1),
  email: z.string().min(3),
  email_verified: z.boolean().optional(),
});

interface RequestContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

@Injectable()
export class GoogleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
    private readonly logger: PinoLogger,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.logger.setContext(GoogleService.name);
  }

  get enabled(): boolean {
    return Boolean(this.env.GOOGLE_CLIENT_ID && this.env.GOOGLE_CLIENT_SECRET);
  }

  /** Where the browser lands afterwards, on success or failure. */
  successUrl(): string {
    return `${this.env.WEB_URL}/account`;
  }

  failureUrl(reason: GoogleFailure): string {
    return `${this.env.WEB_URL}/login?error=google_${reason}`;
  }

  /** Builds the URL to send the browser to, remembering what to check on return. */
  async start(): Promise<string> {
    if (!this.enabled) throw new GoogleSignInError("unavailable");

    const state = generateToken();
    const verifier = generateToken();
    const nonce = generateToken();
    await this.redis.client.set(
      this.stateKey(state),
      JSON.stringify({ verifier, nonce }),
      "EX",
      STATE_TTL_SECONDS,
    );

    const url = new URL(AUTH_ENDPOINT);
    url.search = new URLSearchParams({
      client_id: this.env.GOOGLE_CLIENT_ID ?? "",
      redirect_uri: this.redirectUri(),
      response_type: "code",
      // Only what is needed to identify the person. No profile, no contacts.
      scope: "openid email",
      state,
      nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return url.toString();
  }

  /** Handles Google's redirect back. Issues a session, or throws a GoogleSignInError. */
  async complete(
    query: Record<string, unknown>,
    reply: FastifyReply,
    context: RequestContext,
  ): Promise<void> {
    if (!this.enabled) throw new GoogleSignInError("unavailable");

    const code = str(query.code);
    const state = str(query.state);
    const error = str(query.error);
    if (error) throw new GoogleSignInError(error === "access_denied" ? "denied" : "failed");
    if (!code || !state) throw new GoogleSignInError("failed");

    // GETDEL: a state value is spent the moment it is looked up, replay or not.
    const stored = await this.redis.client.getdel(this.stateKey(state));
    if (!stored) throw new GoogleSignInError("expired");
    const { verifier, nonce } = pending.parse(JSON.parse(stored));

    const claims = await this.exchange(code, verifier);

    if (!ISSUERS.has(claims.iss) || claims.aud !== this.env.GOOGLE_CLIENT_ID) {
      throw new GoogleSignInError("failed");
    }
    if (claims.exp * 1000 <= Date.now() || claims.nonce !== nonce) {
      throw new GoogleSignInError("expired");
    }
    // Without this a Google account created with someone else's address could
    // be linked to that person's account here.
    if (claims.email_verified !== true) throw new GoogleSignInError("unverified_email");

    const email = claims.email.trim().toLowerCase();
    let user: User | undefined;
    for (let attempt = 1; user === undefined; attempt++) {
      try {
        user = await this.resolveUser(claims.sub, email);
      } catch (error) {
        // A new account drew a number someone already holds. Draw again.
        if (uniqueViolationTargets(error, "platform", "username") && attempt < ID_ATTEMPTS) {
          continue;
        }
        throw error;
      }
    }
    if (user.status === "CLOSED") throw new GoogleSignInError("closed");

    await this.sessions.issue(user.id, reply, context);
    this.logger.info({ event: "google.signin", userId: user.id }, "google sign-in completed");
  }

  /*
    Trades the code for an ID token and reads its claims. The signature is not
    verified, deliberately: the token arrives directly from Google over TLS in
    response to a request authenticated with the client secret, which is the
    case Google's own documentation describes as not needing verification.
    The claims are still checked one by one.
  */
  private async exchange(code: string, verifier: string) {
    let response: Response;
    try {
      response = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: this.env.GOOGLE_CLIENT_ID ?? "",
          client_secret: this.env.GOOGLE_CLIENT_SECRET ?? "",
          redirect_uri: this.redirectUri(),
          grant_type: "authorization_code",
          code_verifier: verifier,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(
        { event: "google.token.unreachable", reason: error instanceof Error ? error.message : "" },
        "google token endpoint unreachable",
      );
      throw new GoogleSignInError("failed");
    }

    if (!response.ok) {
      this.logger.warn(
        { event: "google.token.rejected", status: response.status },
        "google rejected the code exchange",
      );
      throw new GoogleSignInError("failed");
    }

    const parsed = tokenResponse.safeParse(await response.json());
    if (!parsed.success) throw new GoogleSignInError("failed");

    const payload = parsed.data.id_token.split(".")[1];
    if (!payload) throw new GoogleSignInError("failed");
    const claims = idTokenClaims.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    if (!claims.success) throw new GoogleSignInError("failed");
    return claims.data;
  }

  /*
    Google account -> user, in one transaction:
      1. a user already linked to this Google account: that user;
      2. a user with this (Google-verified) address: link the Google identity;
      3. nobody: a new user, born verified because Google verified the inbox.
  */
  private resolveUser(sub: string, email: string): Promise<User> {
    return this.prisma.client.$transaction(async (tx) => {
      const linked = await tx.authIdentity.findUnique({
        where: { provider_providerAccountId: { provider: "GOOGLE", providerAccountId: sub } },
        include: { user: true },
      });
      if (linked) return linked.user;

      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) {
        await tx.authIdentity.create({
          data: { userId: existing.id, provider: "GOOGLE", providerAccountId: sub },
        });
        if (!existing.emailVerifiedAt) {
          return tx.user.update({
            where: { id: existing.id },
            data: { emailVerifiedAt: new Date() },
          });
        }
        return existing;
      }

      const platformId = generatePlatformId();
      const username = placeholderUsername(platformId);
      const created = await tx.user.create({
        data: {
          email,
          emailVerifiedAt: new Date(),
          status: "ACTIVE",
          platformId,
          username,
          usernameKey: usernameKey(username),
        },
      });
      await tx.authIdentity.create({
        data: { userId: created.id, provider: "GOOGLE", providerAccountId: sub },
      });
      return created;
    });
  }

  private redirectUri(): string {
    return `${this.env.API_URL}/v1/auth/google/callback`;
  }

  private stateKey(state: string): string {
    return `auth:google-state:${hashToken(state)}`;
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
