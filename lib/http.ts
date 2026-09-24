import { NextResponse } from "next/server";
import type { z } from "zod";

type ParsedBody<T> = { data: T; error?: undefined } | { data?: undefined; error: NextResponse };

/**
 * Reads and validates a JSON request body. Malformed JSON is a 400 like any other invalid
 * input — a bare `await request.json()` throws on it, which surfaced as an unhandled 500.
 */
export async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<ParsedBody<T>> {
  let body: unknown;
  try {
    const raw = await request.text();
    body = raw ? JSON.parse(raw) : undefined;
  } catch {
    return { error: NextResponse.json({ error: "Invalid request" }, { status: 400 }) };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { error: NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 }) };
  }
  return { data: parsed.data };
}

/** Shared response for when the moderation check itself couldn't run (it fails closed). */
export function moderationUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: "Couldn't check this prompt right now. Please try again in a moment." },
    { status: 503 }
  );
}
