// One-time setup: applies an R2 bucket lifecycle rule that auto-expires everything under the
// "guest/" prefix after a fixed number of days. This is the deletion *backstop* the build plan
// calls for (PRD §10: "delete on exit" can't be 100% reliable — browser crashes, force-quits,
// and network drops all mean the app-level Redis TTL purge and the explicit /api/guest/exit
// call can both fail to run). It's independent of and doesn't replace either of those — it's
// what cleans up guest data when neither of them fired.
//
// Run once (or whenever GUEST_DATA_EXPIRY_DAYS changes): `pnpm r2:lifecycle`
// Only ever touches the "guest/" prefix — never "project/" (signed-in users' data, Slice 7+).

import { S3Client, PutBucketLifecycleConfigurationCommand, GetBucketLifecycleConfigurationCommand } from "@aws-sdk/client-s3";

const GUEST_DATA_EXPIRY_DAYS = 2;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name} (run this via \`pnpm r2:lifecycle\`, which loads .env)`);
  }
  return value;
}

const client = new S3Client({
  region: "auto",
  endpoint: requireEnv("R2_ENDPOINT"),
  credentials: {
    accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
  },
});
const bucket = requireEnv("R2_BUCKET");

async function main() {
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: {
        Rules: [
          {
            ID: "expire-guest-data",
            Status: "Enabled",
            Filter: { Prefix: "guest/" },
            Expiration: { Days: GUEST_DATA_EXPIRY_DAYS },
          },
        ],
      },
    })
  );

  const check = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }));
  console.log(`Lifecycle rule applied to bucket "${bucket}":`);
  console.log(JSON.stringify(check.Rules, null, 2));
  console.log(`\nObjects under "guest/" will now auto-expire ${GUEST_DATA_EXPIRY_DAYS} days after creation.`);
}

main().catch((err) => {
  console.error("Failed to apply R2 lifecycle rule:", err);
  process.exit(1);
});
