import { pgTable, text, integer, timestamp, primaryKey, boolean, jsonb } from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";
import type { PromptHints, PrdSection, StackRecommendation } from "@/lib/types";

/**
 * Auth.js DrizzleAdapter's required table shape (users/accounts/verificationTokens for
 * OAuth sign-in; sessions kept even though the app uses JWT sessions, since the adapter
 * type contract expects it and a later slice may want database sessions for revocation).
 */
export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  /** Only meaningful once a githubConnection row exists (repo-scoped token granted) — see lib/github/connection.ts. */
  autoPushToGithub: boolean("autoPushToGithub").notNull().default(false),
});

/**
 * A user's elevated GitHub token (repo scope), separate from the accounts table Auth.js manages
 * for sign-in: sign-in intentionally stays on a least-privilege token (lib/auth.ts), and
 * Auth.js's own account-linking doesn't reliably re-persist a wider-scope token for an
 * already-linked user on re-authorization — this table is written explicitly from the jwt
 * callback instead (see lib/auth.ts), only when the returned scope actually includes "repo".
 */
export const githubConnections = pgTable("github_connection", {
  userId: text("userId")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  githubLogin: text("githubLogin").notNull(),
  /** AES-256-GCM ciphertext (lib/github/tokenCrypto.ts) — never stored in plaintext. */
  encryptedAccessToken: text("encryptedAccessToken").notNull(),
  scope: text("scope").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ]
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (verificationToken) => [
    primaryKey({ columns: [verificationToken.identifier, verificationToken.token] }),
  ]
);

/**
 * Signed-in project data (Slice 8+). A guest session converts into one row per table here;
 * "current" state is just the latest version row per project — no active-version pointer yet
 * since nothing before Slice 10 (version history) needs to address older versions.
 */
export const projects = pgTable("project", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  hints: jsonb("hints").$type<PromptHints>(),
  stackStale: boolean("stackStale").notNull().default(false),
  boilerplateStale: boolean("boilerplateStale").notNull().default(false),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
});

export const prdVersions = pgTable("prd_version", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: text("projectId")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sections: jsonb("sections").notNull().$type<PrdSection[]>(),
  lowConfidence: boolean("lowConfidence").notNull().default(false),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
});

export const stackVersions = pgTable("stack_version", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: text("projectId")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  stack: jsonb("stack").notNull().$type<StackRecommendation>(),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
});

/**
 * No validationStatus column yet: a guest session only ever holds a boilerplateR2Prefix once its
 * (syntax-only, not a real install+build — see lib/sandbox/validateSyntax.ts) check already
 * succeeded (see lib/pipeline/boilerplateWorker.ts), so every converted row is implicitly
 * "succeeded" at that tier. A status enum becomes meaningful once Slice 9+ tracks in-progress/
 * failed generations for signed-in users too.
 */
export const boilerplateVersions = pgTable("boilerplate_version", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: text("projectId")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  r2Prefix: text("r2Prefix").notNull(),
  webContainerCompatible: boolean("webContainerCompatible").notNull().default(false),
  /** Set on a successful auto-push (lib/github/pushBoilerplate.ts) — null if never pushed or the push failed. */
  githubRepoUrl: text("githubRepoUrl"),
  /** Set when an auto-push attempt fails — best-effort, never blocks the conversion itself. */
  githubPushError: text("githubPushError"),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
});
