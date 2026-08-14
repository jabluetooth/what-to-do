import { cookies } from "next/headers";
import { getRedis } from "@/lib/redis";
import type { GuestSession } from "@/lib/types";

const COOKIE_NAME = "wtd_guest_sid";

/** Sliding TTL per PRD 5.1.6 (guest sandbox: 30-60min inactivity timeout). */
export const GUEST_SESSION_TTL_SECONDS = 45 * 60;

function sessionKey(id: string): string {
  return `guest:${id}`;
}

export async function getOrCreateGuestSessionId(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(COOKIE_NAME)?.value;
  if (existing) return existing;

  const id = crypto.randomUUID();
  cookieStore.set(COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_SESSION_TTL_SECONDS,
  });
  return id;
}

export async function readGuestSession(id: string): Promise<GuestSession | null> {
  return getRedis().get<GuestSession>(sessionKey(id));
}

/** Sliding TTL: every write refreshes expiry, matching the "inactivity" framing in the PRD. */
export async function writeGuestSession(id: string, session: GuestSession): Promise<void> {
  await getRedis().set(sessionKey(id), session, { ex: GUEST_SESSION_TTL_SECONDS });
}

export async function deleteGuestSession(id: string): Promise<void> {
  await getRedis().del(sessionKey(id));
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
