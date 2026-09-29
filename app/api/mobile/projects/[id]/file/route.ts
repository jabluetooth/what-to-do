import { NextResponse } from "next/server";
import { requireMobileUserId } from "@/lib/mobileAuth";
import { getLatestVersions, getOwnedProject } from "@/lib/mobile/projects";
import { listProjectFiles } from "@/lib/pipeline/projectFiles";

/** Largest file the code viewer will show; generated files are far smaller in practice. */
const MAX_BYTES = 200_000;

/** One generated file's text, for the phone's read-only code viewer (?path=app/page.tsx). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMobileUserId(request);
  if (auth.error) return auth.error;
  const { id } = await params;
  const path = new URL(request.url).searchParams.get("path");
  if (!path) return NextResponse.json({ error: "Missing path." }, { status: 400 });

  const project = await getOwnedProject(auth.userId, id);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const { boilerplate } = await getLatestVersions(id);
  if (!boilerplate) return NextResponse.json({ error: "No code generated yet." }, { status: 404 });

  // Matched against the stored file list rather than joined into a key, so a crafted path can't
  // reach outside this project's files.
  const file = (await listProjectFiles(boilerplate.r2Prefix)).find((f) => f.path === path);
  if (!file) return NextResponse.json({ error: "File not found." }, { status: 404 });

  const size = Buffer.byteLength(file.content, "utf8");
  if (size > MAX_BYTES) {
    return NextResponse.json({ path, content: file.content.slice(0, MAX_BYTES), truncated: true, size });
  }
  return NextResponse.json({ path, content: file.content, truncated: false, size });
}
