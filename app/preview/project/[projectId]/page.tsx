"use client";

import { useParams } from "next/navigation";
import WebContainerPreview from "@/components/WebContainerPreview";

/** Signed-in "relaunch preview from history" flow — PRD Slice 12, project-scoped reuse of the
 *  guest preview's bootstrap. Ownership of projectId is enforced server-side (see
 *  app/api/account/history/[projectId]/preview-bootstrap/route.ts), not here. */
export default function ProjectPreviewPage() {
  const params = useParams<{ projectId: string }>();
  return (
    <WebContainerPreview
      bootstrapUrl={`/api/account/history/${params.projectId}/preview-bootstrap`}
      backHref="/history"
      backLabel="← Back to History"
    />
  );
}
