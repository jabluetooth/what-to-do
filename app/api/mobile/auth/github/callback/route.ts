import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getRedis } from "@/lib/redis";
import { requireEnv } from "@/lib/env";
import { getDb } from "@/lib/db/client";
import { users, accounts } from "@/lib/db/schema";
import { mintMobileToken } from "@/lib/mobileAuth";

const REQUEST_TIMEOUT_MS = 15_000;

function stateKey(state: string): string {
  return `mobile-auth-state:${state}`;
}

const TokenResponseSchema = z.object({
  access_token: z.string(),
});

async function exchangeCodeForToken(code: string): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: requireEnv("AUTH_GITHUB_ID"),
      client_secret: requireEnv("AUTH_GITHUB_SECRET"),
      code,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`GitHub token exchange failed (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const json = await res.json();
  const parsed = TokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`GitHub token exchange returned an unexpected shape: ${JSON.stringify(json)}`);
  }
  return parsed.data.access_token;
}

const GithubUserSchema = z.object({
  id: z.number(),
  login: z.string(),
  name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  email: z.string().nullable(),
});

const GithubEmailSchema = z.object({
  email: z.string(),
  primary: z.boolean(),
  verified: z.boolean(),
});

interface GithubProfile {
  id: string;
  login: string;
  name: string | null;
  image: string | null;
  email: string;
}

/**
 * GitHub's /user response doesn't reliably include email (depends on the account's public-email
 * setting), so /user/emails is fetched too and the primary verified address is preferred — the
 * same effective behavior as NextAuth's own GitHub provider. Returns null (not a throw) when no
 * usable email is found, since that's a legitimate "can't complete sign-in" outcome, not a bug.
 */
async function fetchGithubProfile(accessToken: string): Promise<GithubProfile | null> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const [userRes, emailsRes] = await Promise.all([
    fetch("https://api.github.com/user", { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
    fetch("https://api.github.com/user/emails", { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
  ]);
  if (!userRes.ok) {
    throw new Error(`GitHub /user failed (${userRes.status}): ${await userRes.text().catch(() => "")}`);
  }
  const user = GithubUserSchema.parse(await userRes.json());

  let email = user.email;
  if (emailsRes.ok) {
    const emails = z.array(GithubEmailSchema).parse(await emailsRes.json());
    const best = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    if (best) email = best.email;
  }
  if (!email) return null;

  return { id: String(user.id), login: user.login, name: user.name, image: user.avatar_url, email };
}

/**
 * Upsert-by-provider-account, falling back to link-by-email for a first-time GitHub sign-in on an
 * email that already has a user row (e.g. from the web app) — mirrors what Auth.js's own
 * DrizzleAdapter does for account linking, done by hand here since the adapter's API targets
 * NextAuth's own request lifecycle, not a standalone OAuth exchange like this one.
 */
async function upsertMobileUser(profile: GithubProfile): Promise<string> {
  const db = getDb();
  const providerAccountId = profile.id;

  const [existingAccount] = await db
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(and(eq(accounts.provider, "github"), eq(accounts.providerAccountId, providerAccountId)))
    .limit(1);
  if (existingAccount) return existingAccount.userId;

  const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, profile.email)).limit(1);

  const userId = existingUser
    ? existingUser.id
    : (
        await db
          .insert(users)
          .values({ name: profile.name, email: profile.email, image: profile.image })
          .returning({ id: users.id })
      )[0].id;

  await db.insert(accounts).values({
    userId,
    type: "oauth",
    provider: "github",
    providerAccountId,
  });

  return userId;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  if (!state) {
    return new NextResponse("Missing state parameter.", { status: 400 });
  }

  // One-time use: whether this completes successfully or not, the same state can't be replayed.
  const stored = await getRedis().get<{ redirectUri: string }>(stateKey(state));
  await getRedis().del(stateKey(state));
  if (!stored) {
    return new NextResponse("This sign-in link has expired. Please try again from the app.", { status: 400 });
  }

  if (errorParam || !code) {
    return NextResponse.redirect(`${stored.redirectUri}?error=access_denied`);
  }

  let profile: GithubProfile | null;
  try {
    const accessToken = await exchangeCodeForToken(code);
    profile = await fetchGithubProfile(accessToken);
  } catch (err) {
    console.error("[mobile-auth] github exchange/profile fetch failed:", err);
    return NextResponse.redirect(`${stored.redirectUri}?error=server_error`);
  }
  if (!profile) {
    return NextResponse.redirect(`${stored.redirectUri}?error=no_verified_email`);
  }

  let userId: string;
  try {
    userId = await upsertMobileUser(profile);
  } catch (err) {
    console.error("[mobile-auth] user upsert failed:", err);
    return NextResponse.redirect(`${stored.redirectUri}?error=server_error`);
  }

  const token = await mintMobileToken(userId);
  return NextResponse.redirect(`${stored.redirectUri}?token=${encodeURIComponent(token)}`);
}
