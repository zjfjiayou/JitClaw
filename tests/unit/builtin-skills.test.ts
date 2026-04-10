// @vitest-environment node
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testResourcesDir } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/jitclaw-builtin-skills-home-${suffix}`,
    testResourcesDir: `/tmp/jitclaw-builtin-skills-resources-${suffix}`,
  };
});

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('../../electron/utils/paths', () => ({
  getResourcesDir: () => testResourcesDir,
}));

vi.mock('../../electron/utils/plugin-install', () => ({
  cpAsyncSafe: async (src: string, dest: string) => {
    const { cp } = await import('node:fs/promises');
    await cp(src, dest, { recursive: true, dereference: true });
  },
}));

vi.mock('../../electron/utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

describe('built-in skill installation', () => {
  const sourceDir = join(testResourcesDir, 'skills', 'builtin', 'jit');
  const sourceManifest = join(sourceDir, 'SKILL.md');
  const sourceReferenceDir = join(sourceDir, 'references');
  const sourceReference = join(sourceReferenceDir, 'tql-query-guide.md');
  const targetDir = join(testHome, '.openclaw', 'skills', 'jit');
  const targetManifest = join(targetDir, 'SKILL.md');
  const targetReference = join(targetDir, 'references', 'tql-query-guide.md');

  beforeEach(async () => {
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
    await rm(testResourcesDir, { recursive: true, force: true });

    await mkdir(sourceReferenceDir, { recursive: true });
    await writeFile(sourceManifest, '---\nname: jit\ndescription: test skill\n---\n\n# jit\n', 'utf-8');
    await writeFile(sourceReference, '# Query guide\n', 'utf-8');
  });

  it('installs the bundled jit skill into ~/.openclaw/skills', async () => {
    const { ensureBuiltinSkillsInstalled } = await import('../../electron/utils/skill-config');

    await ensureBuiltinSkillsInstalled();

    expect(existsSync(targetManifest)).toBe(true);
    expect(existsSync(targetReference)).toBe(true);
    await expect(readFile(targetManifest, 'utf-8')).resolves.toContain('name: jit');
    await expect(readFile(targetReference, 'utf-8')).resolves.toContain('Query guide');
  });

  it('replaces the target directory on subsequent installs to remove stale files', async () => {
    const { ensureBuiltinSkillsInstalled } = await import('../../electron/utils/skill-config');

    await ensureBuiltinSkillsInstalled();
    await writeFile(join(targetDir, 'stale.txt'), 'stale', 'utf-8');
    await writeFile(sourceManifest, '---\nname: jit\ndescription: updated skill\n---\n\n# jit\nUpdated\n', 'utf-8');

    await ensureBuiltinSkillsInstalled();

    expect(existsSync(join(targetDir, 'stale.txt'))).toBe(false);
    await expect(readFile(targetManifest, 'utf-8')).resolves.toContain('updated skill');
  });
});
