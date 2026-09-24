import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { requireEnv } from "@/lib/env";

const STATE_TTL_SECONDS = 5 * 60;

/**
 * redirect_uri is attacker-controllable (anyone can hit this route directly), so without an
 * allowlist a crafted link could bounce a freshly-minted bearer token to an arbitrary host
 * instead of back into the app. Two legitimate schemes exist:
 * - `whattodo://` — the app's own custom scheme, used by a real standalone/dev-client build.
 *   Only this app can receive it.
 * - `exp://` — what `Linking.createURL()` resolves to inside Expo Go. Unlike the custom scheme,
 *   an exp:// URL names a *host*, and Expo Go will happily load any project from any host — so
 *   an unrestricted exp:// allowance let a crafted link hand the 90-day token to an attacker's
 *   own Expo project. Restricted to loopback/private-network hosts, which is where an Expo Go
 *   dev server actually runs (`exp://192.168.x.x:8081`). Tunnel mode (public *.exp.direct hosts)
 *   is deliberately not allowed; use a dev-client build with the custom scheme instead.
 */
const APP_SCHEME_PREFIX = "whattodo://";

function isPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") return true;
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return false;
  const [a, b] = octets;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isAllowedRedirect(redirectUri: string): boolean {
  if (redirectUri.startsWith(APP_SCHEME_PREFIX)) return true;
  if (!redirectUri.startsWith("exp://")) return false;
  try {
    return isPrivateHost(new URL(redirectUri).hostname);
  } catch {
    return false;
  }
}

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

  if (!redirectUri || !isAllowedRedirect(redirectUri)) {
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
