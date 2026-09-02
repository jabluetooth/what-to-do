import { encode, decode } from "next-auth/jwt";
import { NextResponse } from "next/server";
import { requireEnv } from "@/lib/env";

/**
 * Distinct salt from Auth.js's own web session cookie so this is a fully separate token
 * namespace — the mobile app never touches (and can't forge) a web session, and rotating one
 * doesn't affect the other. Both mintMobileToken and getMobileUserId must use this same value.
 */
const MOBILE_TOKEN_SALT = "wtd-mobile-token";

/** 90 days: mobile apps shouldn't force frequent re-logins the way a web session reasonably can. */
const MOBILE_TOKEN_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

export async function mintMobileToken(userId: string): Promise<string> {
  return encode({
    secret: requireEnv("AUTH_SECRET"),
    salt: MOBILE_TOKEN_SALT,
    maxAge: MOBILE_TOKEN_MAX_AGE_SECONDS,
    token: { sub: userId },
  });
}

/** Reads/validates the `Authorization: Bearer <token>` header. Never throws — an invalid, expired, or missing token is just "not signed in". */
export async function getMobileUserId(req: Request): Promise<string | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;

  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  try {
    const payload = await decode({
      token,
      secret: requireEnv("AUTH_SECRET"),
      salt: MOBILE_TOKEN_SALT,
    });
    return typeof payload?.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

type MobileAuthResult = { userId: string; error?: undefined } | { userId?: undefined; error: NextResponse };

/**
 * Ergonomic guard for every mobile route handler: `const auth = await requireMobileUserId(request);
 * if (auth.error) return auth.error;` then use `auth.userId`. Keeps the 401 JSON shape
 * (`{ error: "Unauthorized" }`) consistent in one place instead of every route re-deriving it.
 */
export async function requireMobileUserId(req: Request): Promise<MobileAuthResult> {
  const userId = await getMobileUserId(req);
  if (!userId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId };
}
