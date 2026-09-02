import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { requireEnv } from "@/lib/env";

const STATE_TTL_SECONDS = 5 * 60;

/**
 * redirect_uri is attacker-controllable (anyone can hit this route directly), so without an
 * allowlist a crafted link could bounce a freshly-minted bearer token to an arbitrary host
 * instead of back into the app. Two legitimate schemes exist:
 * - `whattodo://` — the app's own custom scheme, used by a real standalone/dev-client build.
 * - `exp://` — what `Linking.createURL()` resolves to when running inside Expo Go, since Expo Go
 *   has no custom scheme of its own to register. This is true regardless of whether the *backend*
 *   being hit is local or production — testing a deployed backend from Expo Go (this app's normal
 *   dev workflow before a standalone build exists) is a legitimate, expected combination, not a
 *   dev-only case, so this is not gated on NODE_ENV.
 */
const ALLOWED_REDIRECT_PREFIXES = ["whattodo://", "exp://"];

function stateKey(state: string): string {
  return `mobile-auth-state:${state}`;
}

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

  if (!redirectUri || !ALLOWED_REDIRECT_PREFIXES.some((prefix) => redirectUri.startsWith(prefix))) {
    return NextResponse.json({ error: "Missing or unrecognized redirect_uri" }, { status: 400 });
  }

  const state = crypto.randomUUID();
  await getRedis().set(stateKey(state), { redirectUri }, { ex: STATE_TTL_SECONDS });

  const callbackUrl = `${requireEnv("APP_URL")}/api/mobile/auth/github/callback`;
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", requireEnv("AUTH_GITHUB_ID"));
  authorizeUrl.searchParams.set("scope", "read:user user:email");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("redirect_uri", callbackUrl);

  return NextResponse.redirect(authorizeUrl.toString());
}
