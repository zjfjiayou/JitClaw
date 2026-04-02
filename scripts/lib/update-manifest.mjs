import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import yaml from 'js-yaml';

const UPDATE_MANIFEST_FILE_RE = /^(latest|alpha|beta)(?:-[a-z0-9]+)*\.yml$/i;

export function isUpdateManifestFile(filePath) {
  return UPDATE_MANIFEST_FILE_RE.test(basename(filePath));
}

export function dedupeUpdateManifest(manifest) {
  if (manifest == null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { changed: false, manifest };
  }

  if (!Array.isArray(manifest.files)) {
    return { changed: false, manifest };
  }

  const seenUrls = new Set();
  const dedupedFiles = [];

  for (const entry of manifest.files) {
    const url = typeof entry?.url === 'string' ? entry.url : null;
    if (!url) {
      dedupedFiles.push(entry);
      continue;
    }

    if (seenUrls.has(url)) {
      continue;
    }

    seenUrls.add(url);
    dedupedFiles.push(entry);
  }

  if (dedupedFiles.length === manifest.files.length) {
    return { changed: false, manifest };
  }

  return {
    changed: true,
    manifest: {
      ...manifest,
      files: dedupedFiles,
    },
  };
}

export function dedupeUpdateManifestYaml(content) {
  const parsed = yaml.load(content);
  const { changed, manifest } = dedupeUpdateManifest(parsed);

  if (!changed) {
    return { changed: false, content };
  }

  return {
    changed: true,
    content: yaml.dump(manifest, {
      noRefs: true,
      lineWidth: -1,
      sortKeys: false,
    }),
  };
}

export async function dedupeUpdateManifestFile(filePath) {
  if (!isUpdateManifestFile(filePath)) {
    return false;
  }

  const originalContent = await readFile(filePath, 'utf8');
  const { changed, content } = dedupeUpdateManifestYaml(originalContent);

  if (!changed) {
    return false;
  }

  await writeFile(filePath, content);
  return true;
}

export async function dedupeUpdateManifestFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const changedFiles = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const filePath = join(dir, entry.name);
    if (await dedupeUpdateManifestFile(filePath)) {
      changedFiles.push(filePath);
    }
  }

  return changedFiles;
}
