import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { disconnectGithub, setAutoPushToGithub } from "@/lib/github/connection";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const userId = session.user.id;
  await disconnectGithub(userId);
  await setAutoPushToGithub(userId, false);
  return NextResponse.json({ ok: true });
}
