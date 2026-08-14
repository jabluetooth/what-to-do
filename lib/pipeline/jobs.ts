import { getRedis } from "@/lib/redis";

export type JobState = "pending" | "running" | "succeeded" | "failed";

export interface JobRecord {
  id: string;
  sessionId: string;
  stage: "boilerplate";
  state: JobState;
  progress: number;
  message: string;
  error?: string;
  /** R2 prefix on success, e.g. "guest/{sessionId}/{jobId}". */
  resultRef?: string;
  attempt: number;
  createdAt: string;
  updatedAt: string;
}

/** Job lifetime + buffer — independent of the guest session TTL (see build plan §2). */
const JOB_TTL_SECONDS = 60 * 60;

function jobKey(jobId: string): string {
  return `job:${jobId}`;
}

function runLockKey(jobId: string): string {
  return `job:${jobId}:run-lock`;
}

function retryLockKey(jobId: string): string {
  return `job:${jobId}:retry-lock`;
}

/**
 * QStash delivers at least once, and run-stage responds before the worker finishes — without
 * this, a redelivery (network blip, retry policy) runs the same job concurrently: two LLM
 * fill-ins, two install+build cycles, two unordered writes to the same job/R2 state. TTL is a
 * safety net for a crashed/timed-out attempt only; a normal run always releases the lock itself
 * in a finally block, so a legitimate retry (job re-queued as "pending") isn't blocked by it.
 */
const RUN_LOCK_TTL_SECONDS = 600;

export async function claimJobRun(jobId: string): Promise<boolean> {
  const result = await getRedis().set(runLockKey(jobId), "1", { nx: true, ex: RUN_LOCK_TTL_SECONDS });
  return result === "OK";
}

export async function releaseJobRun(jobId: string): Promise<void> {
  await getRedis().del(runLockKey(jobId));
}

/**
 * Short dedup window against a double-click or a retried client request racing itself on
 * POST /retry — without it, two requests can both pass the `state === "failed"` check before
 * either write lands, producing two QStash publishes for one job.
 */
export async function claimJobRetry(jobId: string): Promise<boolean> {
  const result = await getRedis().set(retryLockKey(jobId), "1", { nx: true, ex: 10 });
  return result === "OK";
}

export async function createJob(sessionId: string, stage: "boilerplate"): Promise<JobRecord> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const job: JobRecord = {
    id,
    sessionId,
    stage,
    state: "pending",
    progress: 0,
    message: "Queued",
    attempt: 1,
    createdAt: now,
    updatedAt: now,
  };
  await getRedis().set(jobKey(id), job, { ex: JOB_TTL_SECONDS });
  return job;
}

export async function getJob(jobId: string): Promise<JobRecord | null> {
  return getRedis().get<JobRecord>(jobKey(jobId));
}

export async function updateJob(jobId: string, patch: Partial<JobRecord>): Promise<void> {
  const existing = await getJob(jobId);
  if (!existing) return;
  const updated: JobRecord = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  await getRedis().set(jobKey(jobId), updated, { ex: JOB_TTL_SECONDS });
}
