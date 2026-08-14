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
