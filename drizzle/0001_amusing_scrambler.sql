CREATE TABLE "boilerplate_version" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"r2Prefix" text NOT NULL,
	"webContainerCompatible" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prd_version" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"sections" jsonb NOT NULL,
	"lowConfidence" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"prompt" text NOT NULL,
	"hints" jsonb,
	"stackStale" boolean DEFAULT false NOT NULL,
	"boilerplateStale" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stack_version" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"stack" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boilerplate_version" ADD CONSTRAINT "boilerplate_version_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prd_version" ADD CONSTRAINT "prd_version_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stack_version" ADD CONSTRAINT "stack_version_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;