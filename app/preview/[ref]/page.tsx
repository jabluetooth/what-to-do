"use client";

import WebContainerPreview from "@/components/WebContainerPreview";

/**
 * `ref` (the boilerplate job id) is display-only — the actual boilerplate comes from the
 * httpOnly guest session cookie, never the URL segment (see app/api/preview/bootstrap/route.ts).
 */
export default function PreviewPage() {
  return <WebContainerPreview bootstrapUrl="/api/preview/bootstrap" reportValidationUrl="/api/preview/report-validation" />;
}
