import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  experimental: {
    // Enables `unauthorized()` / `forbidden()` from next/navigation so auth
    // failures render dedicated 401/403 segments instead of generic errors.
    authInterrupts: true,
  },
  async headers() {
    return [
      {
        // Application routes must never be framed by third-party sites.
        // The lookahead excludes the /embed segment specifically: matching the
        // bare prefix would also exempt unrelated paths such as /embedded-x.
        source: "/((?!embed/|embed$).*)",
        headers: [
          ...securityHeaders,
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
      {
        // The embeddable widget is designed to be framed by customer sites.
        // Origin enforcement happens per chatbot in the public chat API.
        source: "/embed/:path*",
        headers: [
          ...securityHeaders,
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
    ];
  },
};

export default nextConfig;
