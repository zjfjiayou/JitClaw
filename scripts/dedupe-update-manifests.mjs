#!/usr/bin/env node

import { resolve } from 'node:path';
import { dedupeUpdateManifestFiles } from './lib/update-manifest.mjs';

const outputDir = resolve(process.cwd(), process.argv[2] || 'release');
const changedFiles = await dedupeUpdateManifestFiles(outputDir);

if (changedFiles.length === 0) {
  console.log(`No update manifests needed dedupe in ${outputDir}`);
  process.exit(0);
}

for (const filePath of changedFiles) {
  console.log(`Deduped update manifest: ${filePath}`);
}
