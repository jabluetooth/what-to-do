import { S3Client } from "@aws-sdk/client-s3";
import { requireEnv } from "@/lib/env";

let client: S3Client | undefined;

export function getR2(): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: requireEnv("R2_ENDPOINT"),
      credentials: {
        accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      },
    });
  }
  return client;
}

export function getR2Bucket(): string {
  return requireEnv("R2_BUCKET");
}
