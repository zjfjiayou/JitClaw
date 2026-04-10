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

  it('reports missing mac jit binaries when only uv binaries exist', () => {
    const rootDir = createTempRoot();
    writeBinary(rootDir, 'resources/bin/darwin-x64/uv');
    writeBinary(rootDir, 'resources/bin/darwin-arm64/uv');

    expect(findMissingBundledBinaryPaths('mac', rootDir)).toEqual([
      join(rootDir, 'resources/bin/darwin-x64/jit'),
      join(rootDir, 'resources/bin/darwin-arm64/jit'),
    ]);

    expect(() => assertBundledBinariesPresent('mac', rootDir))
      .toThrow(/resources\/bin\/darwin-x64\/jit/);
  });

  it('passes when both mac uv and jit binaries exist', () => {
    const rootDir = createTempRoot();
    writeBinary(rootDir, 'resources/bin/darwin-x64/uv');
    writeBinary(rootDir, 'resources/bin/darwin-arm64/uv');
    writeBinary(rootDir, 'resources/bin/darwin-x64/jit');
    writeBinary(rootDir, 'resources/bin/darwin-arm64/jit');

    expect(findMissingBundledBinaryPaths('mac', rootDir)).toEqual([]);
    expect(() => assertBundledBinariesPresent('mac', rootDir)).not.toThrow();
  });

  it('reports missing win jit.exe when uv.exe and node.exe exist', () => {
    const rootDir = createTempRoot();
    writeBinary(rootDir, 'resources/bin/win32-x64/uv.exe');
    writeBinary(rootDir, 'resources/bin/win32-x64/node.exe');

    expect(findMissingBundledBinaryPaths('win', rootDir)).toEqual([
      join(rootDir, 'resources/bin/win32-x64/jit.exe'),
    ]);

    expect(() => assertBundledBinariesPresent('win', rootDir))
      .toThrow(/resources\/bin\/win32-x64\/jit\.exe/);
  });
});
