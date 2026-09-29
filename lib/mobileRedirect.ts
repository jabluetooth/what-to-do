/**
 * Where the mobile app's GitHub round trips (sign-in, and connecting GitHub for pushing) may send
 * the user back to. Shared so both flows enforce exactly the same rule.
 */

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

/**
 * The mobile app's EAS project. Expo Go running a published update resolves the auth callback to
 * `exp://u.expo.dev/<projectId>/--/auth-callback`, and only this project's owner can publish
 * updates under this id — so a public host is safe here when (and only when) the path is pinned
 * to it. Lets the README's "scan to try" QR sign in end to end.
 */
const EXPO_PROJECT_ID = "4a497563-25ce-472d-b169-52634ae6b19d";

function isOwnExpoUpdate(url: URL): boolean {
  return url.hostname === "u.expo.dev" && (url.pathname === `/${EXPO_PROJECT_ID}` || url.pathname.startsWith(`/${EXPO_PROJECT_ID}/`));
}

function isPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") return true;
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return false;
  const [a, b] = octets;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function isAllowedRedirect(redirectUri: string): boolean {
  if (redirectUri.startsWith(APP_SCHEME_PREFIX)) return true;
  if (!redirectUri.startsWith("exp://")) return false;
  try {
    const url = new URL(redirectUri);
    return isPrivateHost(url.hostname) || isOwnExpoUpdate(url);
  } catch {
    return false;
  }
}

/** Redis key for one in-flight mobile OAuth round trip (sign-in or connect). */
export function mobileOAuthStateKey(state: string): string {
  return `mobile-auth-state:${state}`;
}
