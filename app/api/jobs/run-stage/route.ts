import { NextResponse, after } from "next/server";
import { Receiver } from "@upstash/qstash";
import { runBoilerplateJob } from "@/lib/pipeline/boilerplateWorker";
import { requireEnv } from "@/lib/env";

export const runtime = "nodejs";
// Generous ceiling for the interim local-subprocess validator (see lib/sandbox/validate.ts) —
// a real production sandbox targets the PRD's ~60s NFR and wouldn't need this.
export const maxDuration = 300;

let receiver: Receiver | undefined;

function getReceiver(): Receiver {
  if (!receiver) {
    receiver = new Receiver({
      currentSigningKey: requireEnv("QSTASH_CURRENT_SIGNING_KEY"),
      nextSigningKey: requireEnv("QSTASH_NEXT_SIGNING_KEY"),
    });
  }
  return receiver;
}

export async function POST(request: Request) {
  const body = await request.text();

  // QStash can't reach localhost, so local testing calls this route directly rather than via
  // QStash's own delivery — signature verification is skipped outside production accordingly.
  if (process.env.NODE_ENV === "production") {
    const signature = request.headers.get("upstash-signature");
    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 401 });
    }
    try {
      const isValid = await getReceiver().verify({
        signature,
        body,
        url: `${requireEnv("APP_URL")}/api/jobs/run-stage`,
      });
      if (isValid === false) throw new Error("invalid signature");
    } catch {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  const { jobId } = JSON.parse(body) as { jobId: string };

  // Run after responding: the interim local validator can take minutes, far longer than QStash's
  // delivery timeout would tolerate if we blocked the response on it.
  after(() => runBoilerplateJob(jobId));

  return NextResponse.json({ accepted: true });
}
