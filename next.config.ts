import type { NextConfig } from "next";

// Serve Firebase's Google sign-in helper (/__/auth/*) from this site, so the
// sign-in popup and redirect stay on one site. When the helper is only on
// <project>.firebaseapp.com, browsers that block or partition third-party
// storage (Safari and iOS home-screen apps, Brave, Firefox strict, Chrome
// without third-party cookies) can lose the sign-in result. This takes effect
// once NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN is set to this site's host; see
// "Google sign-in on every browser" in the README.
const firebaseProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

const nextConfig: NextConfig = {
  async rewrites() {
    if (!firebaseProjectId || !/^[a-z0-9-]+$/.test(firebaseProjectId)) return [];
    const helper = `https://${firebaseProjectId}.firebaseapp.com`;
    return [
      { source: "/__/auth/:path*", destination: `${helper}/__/auth/:path*` },
      { source: "/__/firebase/:path*", destination: `${helper}/__/firebase/:path*` },
    ];
  },
};

export default nextConfig;
