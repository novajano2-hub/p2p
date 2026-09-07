import type { NextConfig } from "next";

/*
  Baseline browser security headers. A Content-Security-Policy with nonces is
  added in Phase 1 alongside the authenticated app, where inline-script policy
  actually matters. Tracked in docs/open-questions.md, not as a code TODO.
*/
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    // Placeholder photography only. Replace with the real asset host before launch.
    remotePatterns: [{ protocol: "https", hostname: "picsum.photos" }],
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
