import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requireEnv } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/**
 * A leaked githubConnections row is a live repo-write credential for that user's GitHub account
 * — meaningfully more sensitive than the app's own secrets (which live in env vars, not a DB
 * a Postgres dump could expose), so it's encrypted at rest rather than stored as the raw OAuth
 * access token. Key must be a 32-byte value, base64-encoded in GITHUB_TOKEN_ENCRYPTION_KEY
 * (generate with `openssl rand -base64 32`).
 */
function getKey(): Buffer {
  const key = Buffer.from(requireEnv("GITHUB_TOKEN_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) {
    throw new Error("GITHUB_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded).");
  }
  return key;
}

/** Output is `${iv}:${authTag}:${ciphertext}`, each base64 — self-contained, no separate storage needed for iv/tag. */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptToken(ciphertext: string): string {
  const [ivB64, authTagB64, encryptedB64] = ciphertext.split(":");
  if (!ivB64 || !authTagB64 || !encryptedB64) {
    throw new Error("Malformed encrypted token (expected iv:authTag:ciphertext).");
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedB64, "base64")), decipher.final()]);
  return decrypted.toString("utf8");
}
