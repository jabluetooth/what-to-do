import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { requireEnv } from "@/lib/env";
import { isAllowedRedirect, mobileOAuthStateKey } from "@/lib/mobileRedirect";

const STATE_TTL_SECONDS = 5 * 60;

/**
 * Backend-mediated GitHub OAuth for the mobile app: the mobile app opens this URL in a browser,
 * we bounce it through GitHub with OUR OWN fixed callback (below) as the redirect_uri — GitHub
 * OAuth Apps only allow one or a few pre-registered callback URLs, and a per-install custom
 * scheme can't be registered there — then hand a minted bearer token back to the mobile app's
 * own deep link once sign-in completes. Deliberately not the deprecated Expo AuthSession proxy.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const redirectUri = searchParams.get("redirect_uri");

  if (!redirectUri || !isAllowedRedirect(redirectUri)) {
    return NextResponse.json({ error: "Missing or unrecognized redirect_uri" }, { status: 400 });
  }

  const state = crypto.randomUUID();
  await getRedis().set(mobileOAuthStateKey(state), { redirectUri }, { ex: STATE_TTL_SECONDS });

  const callbackUrl = `${requireEnv("APP_URL")}/api/mobile/auth/github/callback`;
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", requireEnv("AUTH_GITHUB_ID"));
  authorizeUrl.searchParams.set("scope", "read:user user:email");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("redirect_uri", callbackUrl);

  return NextResponse.redirect(authorizeUrl.toString());
}
