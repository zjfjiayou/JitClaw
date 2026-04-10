import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

async function createFakeJitBinary(homeDir: string): Promise<{ binDir: string; binName: string }> {
  const binDir = join(homeDir, '.jitclaw-e2e-bin');
  const isWindows = process.platform === 'win32';
  const binName = isWindows ? 'jit.cmd' : 'jit';
  const binPath = join(binDir, binName);
  const content = isWindows
    ? '@echo off\r\necho {"ok":true}\r\n'
    : '#!/bin/sh\nprintf \'{"ok":true}\\n\'\n';

  await mkdir(binDir, { recursive: true });
  await writeFile(binPath, content, 'utf-8');
  if (!isWindows) {
    await chmod(binPath, 0o755);
  }

  return { binDir, binName };
}

async function waitForGatewayRunning(page: Awaited<ReturnType<typeof getStableWindow>>): Promise<void> {
  await expect.poll(async () => {
    return await page.evaluate(async () => {
      const status = await window.electron.ipcRenderer.invoke('gateway:status') as { state?: string };
      return status.state;
    });
  }, { timeout: 60_000, intervals: [500, 1_000, 2_000] }).toBe('running');
}

test.describe('built-in jit skill', () => {
  test('shows the predeployed jit skill after the gateway starts', async ({ homeDir, launchElectronApp }) => {
    const skillDir = join(homeDir, '.openclaw', 'skills', 'jit');
    const description =
      'Inspect or operate the JIT backend with the bundled jit CLI, including auth, app metadata, models, services, raw APIs, and TQL/Q queries.';
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---\nname: jit\ndescription: ${description}\nmetadata: {"openclaw":{"requires":{"bins":["jit"]}}}\n---\n\n# jit\n`,
      'utf-8',
    );

    const { binDir } = await createFakeJitBinary(homeDir);
    const originalPath = process.env.PATH || '';
    process.env.PATH = `${binDir}${process.platform === 'win32' ? ';' : ':'}${originalPath}`;

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const startResult = await page.evaluate(async () => {
        return await window.electron.ipcRenderer.invoke('gateway:start') as { success?: boolean; error?: string };
      });
      expect(startResult.success).toBe(true);

      await waitForGatewayRunning(page);

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByText('jit', { exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(description, { exact: true })).toBeVisible({ timeout: 60_000 });
    } finally {
      process.env.PATH = originalPath;
      await closeElectronApp(app);
    }
  });
});
