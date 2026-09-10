/*
  Defaults for the API test project. CI sets every one of these explicitly;
  locally they point at docker-compose.yml. `??=` means a value already in
  the environment always wins.
*/
process.env.NODE_ENV ??= "test";
process.env.LOG_LEVEL ??= "silent";
process.env.PORT ??= "0";
process.env.HOST ??= "127.0.0.1";
process.env.CORS_ORIGINS ??= "http://localhost:3000";
process.env.WEB_URL ??= "http://localhost:3000";
process.env.API_URL ??= "http://127.0.0.1:3001";
process.env.EMAIL_FROM ??= "BIRQ <test@example.com>";
/*
  Forced blank, not defaulted: a test must never send a real email or write a
  real bucket. Blank reads as absent (see config/env.ts), so codes go to the
  silenced log and tests read them from the database, and photographs go to
  a directory on disk. Forced because the generated Prisma client loads any
  .env it was pointed at when it was generated, and a developer's root .env
  holds real keys; dotenv never overwrites a key that is already present,
  even an empty one, so setting these first is what keeps them out.
*/
process.env.RESEND_API_KEY = "";
process.env.STORAGE_ENDPOINT = "";
process.env.STORAGE_BUCKET = "";
process.env.STORAGE_ACCESS_KEY_ID = "";
process.env.STORAGE_SECRET_ACCESS_KEY = "";
// Google credentials are dummies so the redirect routes exist; nothing here
// ever reaches Google.
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.DATABASE_URL ??= "postgresql://abay_app:app@localhost:5433/abay?schema=public";
process.env.REDIS_URL ??= "redis://localhost:6379";
// Tests talk to the app over plain HTTP, so the cookie cannot be Secure here.
process.env.COOKIE_SECURE ??= "false";
