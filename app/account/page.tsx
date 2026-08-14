import { auth, signIn, signOut } from "@/lib/auth";

/**
 * Slice 7 sign-in smoke test. Not the real sign-up CTA (that's Slice 8, wired into the
 * guest exit flow) — this page exists so GitHub sign-in can be exercised end to end on
 * its own before it's plumbed into the rest of the app.
 */
export default async function AccountPage() {
  const session = await auth();

  return (
    <main style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1.5rem", fontFamily: "sans-serif" }}>
      <h1>Account</h1>
      {session?.user ? (
        <>
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
        </>
      ) : (
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/account" });
          }}
        >
          <button type="submit">Sign in with GitHub</button>
        </form>
      )}
    </main>
  );
}
