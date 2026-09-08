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
process.env.DATABASE_URL ??= "postgresql://abay_app:app@localhost:5432/abay?schema=public";
process.env.REDIS_URL ??= "redis://localhost:6379";
