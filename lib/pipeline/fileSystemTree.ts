export interface FlatFile {
  path: string;
  content: string;
}

/**
 * Structurally compatible with @webcontainer/api's FileSystemTree, defined independently
 * so this server-side builder doesn't import the (browser-only) WebContainer client package.
 */
export type FileSystemTree = {
  [name: string]: { directory: FileSystemTree } | { file: { contents: string } };
};

export function buildFileSystemTree(files: FlatFile[]): FileSystemTree {
  const root: FileSystemTree = {};

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let node = root;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const existing = node[part];
      if (existing && "directory" in existing) {
        node = existing.directory;
      } else {
        const dir: FileSystemTree = {};
        node[part] = { directory: dir };
        node = dir;
      }
    }

    const fileName = parts[parts.length - 1];
    node[fileName] = { file: { contents: file.content } };
  }

  return root;
}
