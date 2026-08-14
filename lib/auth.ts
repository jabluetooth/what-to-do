import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getDb } from "@/lib/db/client";
import { users, accounts, sessions, verificationTokens } from "@/lib/db/schema";
import { requireEnv } from "@/lib/env";

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
      // Least-privilege sign-in scope; repo push (Slice 11) uses a separate GitHub App, not this token.
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
  },
});
