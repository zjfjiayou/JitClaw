import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertBundledBinariesPresent,
  findMissingBundledBinaryPaths,
  normalizePackagingPlatform,
} from '../../scripts/lib/bundled-binaries.mjs';

describe('bundled packaging binaries', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  function createTempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'jitclaw-bundled-binaries-'));
    tempDirs.push(dir);
    return dir;
  }

  function writeBinary(rootDir: string, relativePath: string): void {
    const fullPath = join(rootDir, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, 'binary');
  }

  it('normalizes packaging platform aliases', () => {
    expect(normalizePackagingPlatform('darwin')).toBe('mac');
    expect(normalizePackagingPlatform('win32')).toBe('win');
    expect(normalizePackagingPlatform('linux')).toBe('linux');
  });

  it('reports missing mac arm64 uv when only x64 binary exists', () => {
    const rootDir = createTempRoot();
    writeBinary(rootDir, 'resources/bin/darwin-x64/uv');

    expect(findMissingBundledBinaryPaths('mac', rootDir)).toEqual([
      join(rootDir, 'resources/bin/darwin-arm64/uv'),
    ]);

    expect(() => assertBundledBinariesPresent('mac', rootDir))
      .toThrow(/resources\/bin\/darwin-arm64\/uv/);
  });

  it('passes when both mac uv binaries exist', () => {
    const rootDir = createTempRoot();
    writeBinary(rootDir, 'resources/bin/darwin-x64/uv');
    writeBinary(rootDir, 'resources/bin/darwin-arm64/uv');

    expect(findMissingBundledBinaryPaths('mac', rootDir)).toEqual([]);
    expect(() => assertBundledBinariesPresent('mac', rootDir)).not.toThrow();
  });
});
