import { auth, signIn, signOut } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getGithubConnection, deleteGithubConnection, setAutoPushToGithub } from "@/lib/github/connection";

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
      <main style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1.5rem", fontFamily: "sans-serif" }}>
        <h1>Account</h1>
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/account" });
          }}
        >
          <button type="submit">Sign in with GitHub</button>
        </form>
      </main>
    );
  }

  const userId = session.user.id;
  const [userRow] = await getDb().select({ autoPushToGithub: users.autoPushToGithub }).from(users).where(eq(users.id, userId)).limit(1);
  const connection = await getGithubConnection(userId);
  const autoPushToGithub = userRow?.autoPushToGithub ?? false;

  return (
    <main style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1.5rem", fontFamily: "sans-serif" }}>
      <h1>Account</h1>
      <p>
        Signed in as <strong>{session.user.email ?? session.user.name}</strong>
      </p>
      <p style={{ fontSize: "0.85rem", color: "#666" }}>User ID: {session.user.id}</p>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/account" });
        }}
      >
        <button type="submit">Sign out</button>
      </form>

      <hr style={{ margin: "2rem 0" }} />

      <h2 style={{ fontSize: "1.1rem" }}>GitHub repo push</h2>
      <p style={{ fontSize: "0.9rem", color: "#666" }}>
        When enabled, a new GitHub repo is created automatically from your boilerplate the next time you sign up
        from a guest session.
      </p>

      {connection ? (
        <>
          <p style={{ fontSize: "0.9rem" }}>
            Connected as <strong>{connection.githubLogin}</strong> (repo access granted).
          </p>

          <form
            action={async () => {
              "use server";
              await setAutoPushToGithub(userId, !autoPushToGithub);
            }}
          >
            <button type="submit">{autoPushToGithub ? "Turn off auto-push" : "Turn on auto-push"}</button>
          </form>

          <form
            action={async () => {
              "use server";
              await deleteGithubConnection(userId);
              await setAutoPushToGithub(userId, false);
            }}
          >
            <button type="submit" style={{ marginTop: "0.5rem" }}>
              Disconnect GitHub
            </button>
          </form>
        </>
      ) : (
        <form
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
          <button type="submit">Connect GitHub for repo access</button>
        </form>
      )}
    </main>
  );
}
