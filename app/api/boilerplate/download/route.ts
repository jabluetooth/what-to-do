import { NextResponse } from "next/server";
import { getOrInitGuestSession } from "@/lib/redis/guestSession";
import { readProjectZip } from "@/lib/pipeline/projectFiles";

export async function GET() {
  const { session } = await getOrInitGuestSession();

  if (!session.boilerplateR2Prefix) {
    return NextResponse.json({ error: "No boilerplate available for this session." }, { status: 404 });
  }

  const zip = await readProjectZip(session.boilerplateR2Prefix);
  if (!zip) {
    return NextResponse.json({ error: "Boilerplate archive not found." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="boilerplate.zip"',
    },
  });
}
