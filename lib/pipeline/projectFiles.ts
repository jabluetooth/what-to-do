import {
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import JSZip from "jszip";
import { getR2, getR2Bucket } from "@/lib/r2";
import type { TemplateFile } from "@/lib/pipeline/template";
import type { FlatFile } from "@/lib/pipeline/fileSystemTree";

/**
 * Individual files are stored (not just the zip) because Slice 5's live-preview bootstrap
 * needs to read the file tree back from R2 to mount it in a WebContainer, and the
 * non-WebContainer-stack fallback needs a plain file-tree view — both want per-file access,
 * not an archive that has to be unzipped server-side on every preview boot.
 */
export async function writeProjectFiles(prefix: string, files: TemplateFile[]): Promise<void> {
  const r2 = getR2();
  const bucket = getR2Bucket();

  await Promise.all(
    files.map((file) =>
      r2.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `${prefix}/${file.path}`,
          Body: file.content,
          ContentType: "text/plain; charset=utf-8",
        })
      )
    )
  );
}

export async function buildZip(files: TemplateFile[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.path, file.content);
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function writeProjectZip(prefix: string, zipBuffer: Buffer): Promise<void> {
  const r2 = getR2();
  const bucket = getR2Bucket();

  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `${prefix}/archive.zip`,
      Body: zipBuffer,
      ContentType: "application/zip",
    })
  );
}

/** Reads every individual file back under a prefix (excluding the zip) — used for the live-preview file tree. */
export async function listProjectFiles(prefix: string): Promise<FlatFile[]> {
  const r2 = getR2();
  const bucket = getR2Bucket();

  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await r2.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: `${prefix}/`, ContinuationToken: continuationToken })
    );
    for (const obj of page.Contents ?? []) {
      if (obj.Key && obj.Key !== `${prefix}/archive.zip`) keys.push(obj.Key);
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  return Promise.all(
    keys.map(async (key) => {
      const result = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const content = (await result.Body?.transformToString()) ?? "";
      return { path: key.slice(prefix.length + 1), content };
    })
  );
}

/** Deletes every object under a prefix, including the zip — used by the explicit guest-exit purge. */
export async function deleteProjectFiles(prefix: string): Promise<void> {
  const r2 = getR2();
  const bucket = getR2Bucket();

  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await r2.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: `${prefix}/`, ContinuationToken: continuationToken })
    );
    for (const obj of page.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  if (keys.length === 0) return;

  await r2.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })) },
    })
  );
}

/**
 * Server-side copy (no download/upload round trip) — used by guest->account conversion to move
 * a boilerplate out of the expiring "guest/" prefix into a persistent "project/" one.
 */
export async function copyProjectFiles(sourcePrefix: string, destPrefix: string): Promise<void> {
  const r2 = getR2();
  const bucket = getR2Bucket();

  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await r2.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: `${sourcePrefix}/`, ContinuationToken: continuationToken })
    );
    for (const obj of page.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  await Promise.all(
    keys.map((key) => {
      const destKey = `${destPrefix}/${key.slice(sourcePrefix.length + 1)}`;
      return r2.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: encodeURIComponent(`${bucket}/${key}`),
          Key: destKey,
        })
      );
    })
  );
}

export async function readProjectZip(prefix: string): Promise<Buffer | null> {
  const r2 = getR2();
  const bucket = getR2Bucket();

  try {
    const result = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: `${prefix}/archive.zip` }));
    const bytes = await result.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") return null;
    throw err;
  }
}
