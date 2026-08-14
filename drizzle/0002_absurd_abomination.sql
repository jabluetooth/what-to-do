CREATE TABLE "github_connection" (
	"userId" text PRIMARY KEY NOT NULL,
	"githubLogin" text NOT NULL,
	"encryptedAccessToken" text NOT NULL,
	"scope" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boilerplate_version" ADD COLUMN "githubRepoUrl" text;--> statement-breakpoint
ALTER TABLE "boilerplate_version" ADD COLUMN "githubPushError" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "autoPushToGithub" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "github_connection" ADD CONSTRAINT "github_connection_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;