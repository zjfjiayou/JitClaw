import { describe, expect, it } from 'vitest';
import {
  dedupeUpdateManifest,
  dedupeUpdateManifestYaml,
  isUpdateManifestFile,
} from '../../scripts/lib/update-manifest.mjs';

describe('update manifest dedupe', () => {
  it('matches electron-updater manifest filenames only', () => {
    expect(isUpdateManifestFile('beta-mac.yml')).toBe(true);
    expect(isUpdateManifestFile('alpha-linux-arm64.yml')).toBe(true);
    expect(isUpdateManifestFile('latest.yml')).toBe(true);
    expect(isUpdateManifestFile('builder-debug.yml')).toBe(false);
    expect(isUpdateManifestFile('builder-effective-config.yaml')).toBe(false);
  });

  it('dedupes files by url while preserving first occurrence order', () => {
    const manifest = {
      version: '0.0.1-beta.1',
      files: [
        { url: 'JitClaw-0.0.1-beta.1-mac-arm64.zip', sha512: 'a', size: 1 },
        { url: 'JitClaw-0.0.1-beta.1-mac-x64.zip', sha512: 'b', size: 2 },
        { url: 'JitClaw-0.0.1-beta.1-mac-x64.zip', sha512: 'b', size: 2 },
        { url: 'JitClaw-0.0.1-beta.1-mac-arm64.dmg', sha512: 'c', size: 3 },
        { url: 'JitClaw-0.0.1-beta.1-mac-arm64.dmg', sha512: 'c', size: 3 },
      ],
      path: 'JitClaw-0.0.1-beta.1-mac-arm64.zip',
      sha512: 'a',
    };

    const { changed, manifest: deduped } = dedupeUpdateManifest(manifest);

    expect(changed).toBe(true);
    expect(deduped.files).toEqual([
      { url: 'JitClaw-0.0.1-beta.1-mac-arm64.zip', sha512: 'a', size: 1 },
      { url: 'JitClaw-0.0.1-beta.1-mac-x64.zip', sha512: 'b', size: 2 },
      { url: 'JitClaw-0.0.1-beta.1-mac-arm64.dmg', sha512: 'c', size: 3 },
    ]);
    expect(deduped.path).toBe('JitClaw-0.0.1-beta.1-mac-arm64.zip');
    expect(deduped.sha512).toBe('a');
  });

  it('leaves already-clean yaml unchanged', () => {
    const input = [
      'version: 0.0.1-beta.1',
      'files:',
      '  - url: JitClaw-0.0.1-beta.1-mac-arm64.zip',
      '    sha512: a',
      '    size: 1',
      'path: JitClaw-0.0.1-beta.1-mac-arm64.zip',
      'sha512: a',
      '',
    ].join('\n');

    const result = dedupeUpdateManifestYaml(input);
    expect(result.changed).toBe(false);
    expect(result.content).toBe(input);
  });
});
