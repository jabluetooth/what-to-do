import { getQStash } from "@/lib/qstash";
import { requireEnv } from "@/lib/env";
import { runBoilerplateJob } from "@/lib/pipeline/boilerplateWorker";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLoopback(url: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * QStash actively rejects loopback destination URLs ("invalid destination url: endpoint
 * resolves to a loopback address") rather than just failing to deliver — confirmed live.
 * Local dev (APP_URL=http://localhost:3000) can't use real QStash delivery at all, so this
 * runs the worker in-process instead, using the exact same runBoilerplateJob() function
 * /api/jobs/run-stage would call for a real QStash-delivered request. Production, with a
 * real public APP_URL, is unaffected and always publishes to QStash.
 */
export async function enqueueBoilerplateJob(jobId: string): Promise<void> {
  const appUrl = requireEnv("APP_URL");

  if (isLoopback(appUrl)) {
    console.warn(`[jobs] APP_URL is a loopback address — running job ${jobId} in-process instead of via QStash.`);
    void runBoilerplateJob(jobId);
    return;
  }

  await getQStash().publishJSON({
    url: `${appUrl}/api/jobs/run-stage`,
    body: { jobId },
  });
}
