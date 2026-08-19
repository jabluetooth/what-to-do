import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { setAutoPushToGithub } from "@/lib/github/connection";

const BodySchema = z.object({ enabled: z.boolean() });

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  await setAutoPushToGithub(session.user.id, parsed.data.enabled);
  return NextResponse.json({ autoPushToGithub: parsed.data.enabled });
}
