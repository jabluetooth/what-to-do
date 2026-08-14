import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The boilerplate job worker reads templates/** via fs at runtime, not via import,
  // so Next's output file tracing can't discover it by static analysis — without this,
  // the templates directory would silently be missing from the deployed function bundle.
  outputFileTracingIncludes: {
    "/api/jobs/run-stage": ["./templates/**/*"],
  },
  // WebContainers require cross-origin isolation (SharedArrayBuffer). Scoped to /preview only —
  // applying this site-wide can break OAuth popups and other cross-origin embeds elsewhere.
  async headers() {
    return [
      {
        source: "/preview/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
