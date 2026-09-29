import { NextResponse } from "next/server";
import { z } from "zod";
import { getRedis } from "@/lib/redis";
import { requireEnv } from "@/lib/env";
import { requireMobileUserId } from "@/lib/mobileAuth";
import { isAllowedRedirect, mobileOAuthStateKey } from "@/lib/mobileRedirect";
import { parseJsonBody } from "@/lib/http";

const STATE_TTL_SECONDS = 5 * 60;

const BodySchema = z.object({ redirect_uri: z.string().min(1).max(500) });

/**
 * Starts "Connect GitHub" from the phone: the one-time grant of repo access that pushing needs
 * (sign-in itself stays read-only). Bearer-authenticated here, so the round trip is bound to the
 * signed-in user up front; the browser leg then goes straight to GitHub's authorize page and back
 * through the existing mobile callback, which recognises `purpose: "connect"` and stores the
 * repo-scoped token (encrypted) as this user's github_connection — the same row the web's
 * Connect GitHub writes.
 */
export async function POST(request: Request) {
  const auth = await requireMobileUserId(request);
  if (auth.error) return auth.error;

  const parsed = await parseJsonBody(request, BodySchema);
  if (parsed.error) return parsed.error;
  const redirectUri = parsed.data.redirect_uri;
  if (!isAllowedRedirect(redirectUri)) {
    return NextResponse.json({ error: "Missing or unrecognized redirect_uri" }, { status: 400 });
  }

  const state = crypto.randomUUID();
  await getRedis().set(
    mobileOAuthStateKey(state),
    { redirectUri, purpose: "connect", userId: auth.userId },
    { ex: STATE_TTL_SECONDS }
  );

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", requireEnv("AUTH_GITHUB_ID"));
  authorizeUrl.searchParams.set("scope", "read:user user:email repo");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("redirect_uri", `${requireEnv("APP_URL")}/api/mobile/auth/github/callback`);

  return NextResponse.json({ url: authorizeUrl.toString() });
}
