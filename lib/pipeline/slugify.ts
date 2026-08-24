/** Lowercase, hyphenated, filesystem/URL-safe slug — used for both GitHub repo names and download filenames. */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    // The slice above can land right after a run of hyphens, leaving one dangling — trim again.
    .replace(/-+$/g, "");
  return slug || "app";
}
