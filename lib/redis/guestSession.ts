import { cookies } from "next/headers";
import { getRedis } from "@/lib/redis";
import type { GuestSession } from "@/lib/types";

const COOKIE_NAME = "wtd_guest_sid";

/** Sliding TTL per PRD 5.1.6 (guest sandbox: 30-60min inactivity timeout). */
export const GUEST_SESSION_TTL_SECONDS = 45 * 60;

function sessionKey(id: string): string {
  return `guest:${id}`;
}

async function setGuestCookie(id: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_SESSION_TTL_SECONDS,
  });
}

export async function getOrCreateGuestSessionId(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(COOKIE_NAME)?.value;
  if (existing) return existing;

  const id = crypto.randomUUID();
  await setGuestCookie(id);
  return id;
}

export async function readGuestSession(id: string): Promise<GuestSession | null> {
  return getRedis().get<GuestSession>(sessionKey(id));
}

/**
 * Sliding TTL: every write refreshes both the Redis expiry and the cookie's maxAge. Without
 * refreshing the cookie too, it would expire at a fixed 45 minutes from first visit regardless
 * of activity — silently breaking the "inactivity" framing (an active user's browser would just
 * stop sending the cookie) while the Redis data underneath kept correctly sliding.
 */
export async function writeGuestSession(id: string, session: GuestSession): Promise<void> {
  await Promise.all([getRedis().set(sessionKey(id), session, { ex: GUEST_SESSION_TTL_SECONDS }), setGuestCookie(id)]);
}

export async function deleteGuestSession(id: string): Promise<void> {
  await getRedis().del(sessionKey(id));
}

/** Seconds until the guest session expires from inactivity; 0 if it doesn't exist. */
export async function getGuestSessionTtlSeconds(id: string): Promise<number> {
  const ttl = await getRedis().ttl(sessionKey(id));
  return ttl > 0 ? ttl : 0;
}

/** Re-writes the session unchanged, sliding both the Redis TTL and the cookie together. */
export async function refreshGuestSession(id: string): Promise<GuestSession | null> {
  const session = await readGuestSession(id);
  if (!session) return null;
  await writeGuestSession(id, session);
  return session;
}

export async function getOrInitGuestSession(): Promise<{ id: string; session: GuestSession }> {
  const id = await getOrCreateGuestSessionId();
  const existing = await readGuestSession(id);
  if (existing) return { id, session: existing };

  const now = new Date().toISOString();
  const fresh: GuestSession = {
    id,
    currentStage: "intake",
    createdAt: now,
    updatedAt: now,
  };
  await writeGuestSession(id, fresh);
  return { id, session: fresh };
}
