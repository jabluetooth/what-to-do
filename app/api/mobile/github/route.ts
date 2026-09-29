import { NextResponse } from "next/server";
import { requireMobileUserId } from "@/lib/mobileAuth";
import { disconnectGithub, getGithubConnectionStatus, hasRepoScope } from "@/lib/github/connection";

/** Whether this user can push: a stored, decryptable GitHub token that has repo scope. */
export async function GET(request: Request) {
  const auth = await requireMobileUserId(request);
  if (auth.error) return auth.error;

  const status = await getGithubConnectionStatus(auth.userId);
  return NextResponse.json({
    connected: !!status && status.usable && hasRepoScope(status.scope),
    login: status?.githubLogin ?? null,
  });
}

/** Disconnect: revokes the grant at GitHub, then removes the stored token (web: same helper). */
export async function DELETE(request: Request) {
  const auth = await requireMobileUserId(request);
  if (auth.error) return auth.error;

  await disconnectGithub(auth.userId);
  return new NextResponse(null, { status: 204 });
}
