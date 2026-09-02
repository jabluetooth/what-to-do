import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { requireEnv } from "@/lib/env";

const STATE_TTL_SECONDS = 5 * 60;

/**
 * Only the mobile app's own custom scheme is allowed as a callback target — redirect_uri is
 * attacker-controllable (anyone can hit this route directly), and without an allowlist a crafted
 * link could bounce a freshly-minted bearer token to an arbitrary host instead of back into the
 * app. Update this if the Expo app's scheme changes.
 *
 * `exp://` is additionally allowed outside production only: `Linking.createURL()` resolves to an
 * `exp://<host>/--/auth-callback` URL (not the app's `whattodo://` scheme) when running inside
 * Expo Go during development, since Expo Go has no custom scheme of its own to register. A real
 * standalone/dev-client build always produces a `whattodo://` URL, so this widened allowlist never
 * applies once deployed — dropping it there also closes the otherwise-broad `exp://` prefix.
 */
const ALLOWED_REDIRECT_PREFIXES =
  process.env.NODE_ENV === "production" ? ["whattodo://"] : ["whattodo://", "exp://"];

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
