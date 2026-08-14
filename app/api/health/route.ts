import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getRedis } from "@/lib/redis";
import { getQStash } from "@/lib/qstash";
import { getR2, getR2Bucket } from "@/lib/r2";
import { getGroq } from "@/lib/groq";
import { getDb } from "@/lib/db/client";

type CheckResult = { ok: boolean; error?: string };

async function checkRedis(): Promise<CheckResult> {
  try {
    await getRedis().ping();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function checkQStash(): Promise<CheckResult> {
  try {
    getQStash();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function checkR2(): Promise<CheckResult> {
  try {
    getR2();
    getR2Bucket();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function checkGroq(): Promise<CheckResult> {
  try {
    getGroq();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function checkDb(): Promise<CheckResult> {
  try {
    await getDb().execute(sql`select 1`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function GET() {
  const [redis, qstash, r2, groq, db] = await Promise.all([
    checkRedis(),
    checkQStash(),
    checkR2(),
    checkGroq(),
    checkDb(),
  ]);

  const checks = { redis, qstash, r2, groq, db };
  const allOk = Object.values(checks).every((c) => c.ok);

  return NextResponse.json({ ok: allOk, checks }, { status: allOk ? 200 : 503 });
}
