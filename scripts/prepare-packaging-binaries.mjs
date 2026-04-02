#!/usr/bin/env zx

import 'zx/globals';
import {
  assertBundledBinariesPresent,
  findMissingBundledBinaryPaths,
  normalizePackagingPlatform,
} from './lib/bundled-binaries.mjs';

const DOWNLOAD_COMMANDS = {
  mac: [
    ['zx', 'scripts/download-bundled-uv.mjs', '--platform=mac'],
  ],
  linux: [
    ['zx', 'scripts/download-bundled-uv.mjs', '--platform=linux'],
  ],
  win: [
    ['zx', 'scripts/download-bundled-uv.mjs', '--platform=win'],
    ['zx', 'scripts/download-bundled-node.mjs', '--platform=win'],
  ],
};

/**
 * @param {'mac' | 'win' | 'linux'} platform
 * @returns {Promise<void>}
 */
async function downloadMissingBundledBinaries(platform) {
  const commands = DOWNLOAD_COMMANDS[platform];
  for (const [command, ...args] of commands) {
    await $`${command} ${args}`;
  }
}

const requestedPlatform = typeof argv.platform === 'string' ? argv.platform : undefined;
const platform = normalizePackagingPlatform(requestedPlatform);
const missingBefore = findMissingBundledBinaryPaths(platform);

if (missingBefore.length > 0) {
  echo(chalk.yellow(`⚠️ Missing bundled binaries for ${platform}; downloading required assets...`));
  await downloadMissingBundledBinaries(platform);
} else {
  echo(chalk.green(`✅ Bundled binaries already present for ${platform}.`));
}

assertBundledBinariesPresent(platform);
echo(chalk.green(`✅ Bundled binary verification passed for ${platform}.`));
