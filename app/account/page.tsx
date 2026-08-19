import { revalidatePath } from "next/cache";
import { auth, signIn, signOut } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  getGithubConnectionStatus,
  disconnectGithub,
  setAutoPushToGithub,
  connectionNeedsReauth as deriveConnectionNeedsReauth,
} from "@/lib/github/connection";
import { getLatestGithubPushResult } from "@/lib/github/pushBoilerplate";

const buttonClass =
  "rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-medium disabled:opacity-50";
const secondaryButtonClass =
  "rounded-md border border-neutral-300 dark:border-neutral-700 px-4 py-2 text-sm font-medium";

/**
 * Started as a Slice 7 sign-in smoke test; now also the one settings surface signed-in users
 * have (no project dashboard yet — see the PRD gap analysis). GitHub repo access is a distinct,
 * explicit opt-in step here rather than requested at sign-in, matching the least-privilege
 * default in lib/auth.ts.
 */
export default async function AccountPage() {
  const session = await auth();

  if (!session?.user?.id) {
    return (
      <main className="max-w-lg mx-auto mt-16 px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <form
          className="mt-6"
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/account" });
          }}
        >
          <button type="submit" className={buttonClass}>
            Sign in with GitHub
          </button>
        </form>
      </main>
    );
  }

  const userId = session.user.id;
  const [userRow] = await getDb()
    .select({ autoPushToGithub: users.autoPushToGithub })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const connection = await getGithubConnectionStatus(userId);
  const autoPushToGithub = userRow?.autoPushToGithub ?? false;
  const lastPush = await getLatestGithubPushResult(userId);
  const connectionNeedsReauth = deriveConnectionNeedsReauth(connection, lastPush);

  // Explicit absolute assignments, not a toggle: negating a render-time snapshot meant a stale
  // page (two tabs open, a bfcache restore) could invert the *opposite* of what the user
  // intended. Setting to an explicit true/false is idempotent — a stale render can show the
  // wrong label, but clicking it can never flip the setting to something the user didn't ask
  // for, just possibly re-assert what's already there.
  async function enableAutoPush() {
    "use server";
    await setAutoPushToGithub(userId, true);
    revalidatePath("/account");
  }
  async function disableAutoPush() {
    "use server";
    await setAutoPushToGithub(userId, false);
    revalidatePath("/account");
  }

  return (
    <main className="max-w-lg mx-auto mt-16 px-6 pb-16">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
      <p className="mt-2 text-sm">
        Signed in as <strong>{session.user.email ?? session.user.name}</strong>
      </p>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">User ID: {session.user.id}</p>
      <form
        className="mt-3"
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/account" });
        }}
      >
        <button type="submit" className={secondaryButtonClass}>
          Sign out
        </button>
      </form>

      <hr className="my-8 border-neutral-200 dark:border-neutral-800" />

      <h2 className="text-lg font-semibold">GitHub repo push</h2>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        When enabled, a new GitHub repo is created automatically from your boilerplate the next time you sign up
        from a guest session.
      </p>

      {connection ? (
        <div className="mt-4 space-y-3">
          {!connectionNeedsReauth ? (
            <p className="text-sm">
              Connected as <strong>{connection.githubLogin}</strong> (repo access granted).
            </p>
          ) : (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Your GitHub connection needs to be re-established (
              {!connection.usable
                ? "couldn't verify it's still valid"
                : "GitHub rejected the stored access, likely revoked on GitHub's side"}
              ) — disconnect below, then reconnect.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <form action={autoPushToGithub ? disableAutoPush : enableAutoPush}>
              {/* Only blocks turning it *on* with a broken connection (pointless — it would just
                  fail the same way) — always allow turning an already-on toggle back off, even
                  when broken, so a user isn't stuck with no way to stop the repeated failures
                  short of the separate Disconnect button. */}
              <button
                type="submit"
                disabled={connectionNeedsReauth && !autoPushToGithub}
                className={secondaryButtonClass}
              >
                {autoPushToGithub ? "Turn off auto-push" : "Turn on auto-push"}
              </button>
            </form>

            <form
              action={async () => {
                "use server";
                await disconnectGithub(userId);
                await setAutoPushToGithub(userId, false);
                revalidatePath("/account");
              }}
            >
              <button type="submit" className={secondaryButtonClass}>
                Disconnect GitHub
              </button>
            </form>
          </div>
        </div>
      ) : (
        <form
          className="mt-4"
          action={async () => {
            "use server";
            // A distinct re-authorization requesting the additional "repo" scope — GitHub shows
            // its own consent screen for the new permission (the "ask permission" step). The
            // resulting token is captured and persisted from lib/auth.ts's jwt callback.
            // authorizationParams is next-auth's signIn()'s 3rd positional argument, NOT a field
            // on the options object (confirmed against node_modules/next-auth/lib/actions.js) —
            // nesting it inside options silently drops it and the scope request never happens.
            await signIn("github", { redirectTo: "/account" }, { scope: "read:user user:email repo" });
          }}
        >
          <button type="submit" className={buttonClass}>
            Connect GitHub for repo access
          </button>
        </form>
      )}

      {lastPush && (
        <div className="mt-4 rounded-md border border-neutral-200 dark:border-neutral-800 p-3 text-sm">
          <p className="font-medium">Last push</p>
          {lastPush.repoUrl ? (
            <p className="mt-1">
              <a href={lastPush.repoUrl} target="_blank" rel="noopener noreferrer" className="underline">
                {lastPush.repoUrl}
              </a>
            </p>
          ) : (
            <>
              <p className="mt-1 text-red-600 dark:text-red-400">Failed: {lastPush.error}</p>
              {connection && connection.usable && lastPush.createdAt < connection.updatedAt && (
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  Recorded before your most recent reconnect, so this doesn&apos;t reflect your current
                  connection — it&apos;ll update the next time an auto-push runs.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </main>
  );
}
