import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getDb } from "@/lib/db/client";
import { users, accounts, sessions, verificationTokens } from "@/lib/db/schema";
import { requireEnv } from "@/lib/env";
import { upsertGithubConnection } from "@/lib/github/connection";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    GitHub({
      clientId: requireEnv("AUTH_GITHUB_ID"),
      clientSecret: requireEnv("AUTH_GITHUB_SECRET"),
      // Least-privilege default sign-in scope. A user who opts into GitHub auto-push
      // re-authorizes with an additional "repo" scope via signIn("github", { authorizationParams:
      // { scope: "read:user user:email repo" } }) from the account page — GitHub shows its own
      // consent screen for the added permission, which is the "ask permission" step.
      authorization: { params: { scope: "read:user user:email" } },
    }),
  ],
  session: { strategy: "jwt" },
  secret: requireEnv("AUTH_SECRET"),
  callbacks: {
    session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
    /**
     * `account`/`profile` are only present on the request where a sign-in just completed, not on
     * later session reads — that's what makes this the right place to catch a repo-scope
     * re-authorization. The DrizzleAdapter's `accounts` table isn't reliably rewritten for an
     * already-linked user re-authorizing with a wider scope, so the elevated token is persisted
     * separately here (lib/github/connection.ts) instead of relying on adapter internals.
     * Must keep setting token.sub = user.id manually: providing a custom jwt callback replaces
     * Auth.js's default one entirely, and the session callback above depends on token.sub.
     */
    async jwt({ token, user, account, profile }) {
      if (user) token.sub = user.id;

      if (account?.provider === "github" && account.access_token && account.scope?.includes("repo")) {
        const login = typeof profile?.login === "string" ? profile.login : "unknown";
        await upsertGithubConnection({
          userId: token.sub!,
          githubLogin: login,
          accessToken: account.access_token,
          scope: account.scope,
        });
      }

      return token;
    },
  },
});
