import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT_DIR = join(MODULE_DIR, '..', '..');
const PLATFORM_ALIASES = {
  mac: 'mac',
  darwin: 'mac',
  win: 'win',
  win32: 'win',
  windows: 'win',
  linux: 'linux',
};

export const PLATFORM_REQUIREMENTS = {
  mac: [
    ['resources', 'bin', 'darwin-x64', 'uv'],
    ['resources', 'bin', 'darwin-arm64', 'uv'],
    ['resources', 'bin', 'darwin-x64', 'jit'],
    ['resources', 'bin', 'darwin-arm64', 'jit'],
  ],
  win: [
    ['resources', 'bin', 'win32-x64', 'uv.exe'],
    ['resources', 'bin', 'win32-x64', 'node.exe'],
    ['resources', 'bin', 'win32-x64', 'jit.exe'],
  ],
  linux: [
    ['resources', 'bin', 'linux-x64', 'uv'],
    ['resources', 'bin', 'linux-arm64', 'uv'],
    ['resources', 'bin', 'linux-x64', 'jit'],
    ['resources', 'bin', 'linux-arm64', 'jit'],
  ],
};

/**
 * @param {string} [platform]
 * @returns {'mac' | 'win' | 'linux'}
 */
export function normalizePackagingPlatform(platform = process.platform) {
  const value = platform.trim().toLowerCase();
  const normalized = PLATFORM_ALIASES[value];
  if (normalized) {
    return normalized;
  }

  throw new Error(`Unsupported packaging platform: ${platform}`);
}

/**
 * @param {string} platform
 * @param {string} [rootDir]
 * @returns {string[]}
 */
export function getRequiredBundledBinaryPaths(platform, rootDir = DEFAULT_ROOT_DIR) {
  const normalized = normalizePackagingPlatform(platform);
  return PLATFORM_REQUIREMENTS[normalized].map((segments) => join(rootDir, ...segments));
}

/**
 * @param {string} platform
 * @param {string} [rootDir]
 * @returns {string[]}
 */
export function findMissingBundledBinaryPaths(platform, rootDir = DEFAULT_ROOT_DIR) {
  return getRequiredBundledBinaryPaths(platform, rootDir).filter((filepath) => !existsSync(filepath));
}

/**
 * @param {string} platform
 * @param {string} [rootDir]
 * @returns {void}
 */
export function assertBundledBinariesPresent(platform, rootDir = DEFAULT_ROOT_DIR) {
  const normalized = normalizePackagingPlatform(platform);
  const missingPaths = findMissingBundledBinaryPaths(normalized, rootDir);

  if (missingPaths.length === 0) {
    return;
  }

  const relativePaths = missingPaths.map((filepath) => relative(rootDir, filepath));
  throw new Error(
    `Missing bundled binaries for ${normalized} packaging:\n` +
    relativePaths.map((filepath) => `- ${filepath}`).join('\n')
  );
}
