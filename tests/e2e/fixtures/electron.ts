import electronBinaryPath from 'electron';
import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

type LaunchElectronOptions = {
  skipSetup?: boolean;
};

type ElectronFixtures = {
  electronApp: ElectronApplication;
  page: Page;
  homeDir: string;
  userDataDir: string;
  launchElectronApp: (options?: LaunchElectronOptions) => Promise<ElectronApplication>;
};

const repoRoot = resolve(process.cwd());
const electronEntry = join(repoRoot, 'dist-electron/main/index.js');

async function allocatePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate an ephemeral port')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

async function getStableWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 30_000;
  let page = await app.firstWindow();

  while (Date.now() < deadline) {
    const openWindows = app.windows().filter((candidate) => !candidate.isClosed());
    const currentWindow = openWindows.at(-1) ?? page;

    if (currentWindow && !currentWindow.isClosed()) {
      try {
        await currentWindow.waitForLoadState('domcontentloaded', { timeout: 2_000 });
        return currentWindow;
      } catch (error) {
        if (!String(error).includes('has been closed')) {
          throw error;
        }
      }
    }

    try {
      page = await app.waitForEvent('window', { timeout: 2_000 });
    } catch {
      // Keep polling until a stable window is available or the deadline expires.
    }
  }

  throw new Error('No stable Electron window became available');
}

async function closeElectronApp(app: ElectronApplication, timeoutMs = 5_000): Promise<void> {
  let closed = false;

  await Promise.race([
    (async () => {
      const [closeResult] = await Promise.allSettled([
        app.waitForEvent('close', { timeout: timeoutMs }),
        app.evaluate(({ app: electronApp }) => {
          electronApp.quit();
        }),
      ]);

      if (closeResult.status === 'fulfilled') {
        closed = true;
      }
    })(),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);

  if (closed) {
    return;
  }

  try {
    await app.close();
    return;
  } catch {
    // Fall through to process kill if Playwright cannot close the app cleanly.
  }

  try {
    app.process().kill('SIGKILL');
  } catch {
    // Ignore process kill failures during e2e teardown.
  }
}

async function startNewApiMockServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  let hardLimitUsd = 120.0;
  const server = createHttpServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');

    if (req.url === '/v1/models') {
      res.writeHead(200);
      res.end(JSON.stringify({
        object: 'list',
        data: [
          { id: 'gpt-4.1-mini', object: 'model', created: 1710000000, owned_by: 'openai' },
          { id: 'claude-3.7-sonnet', object: 'model', created: 1710000100, owned_by: 'anthropic' },
        ],
      }));
      return;
    }

    if (req.url === '/api/user/self') {
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        data: {
          id: 42,
          username: 'e2e-user',
          quota: 120,
          used_quota: 45,
          request_count: 19,
        },
      }));
      return;
    }

    if (req.url?.startsWith('/api/token/')) {
      if (req.method === 'POST' && req.url === '/api/token/1/key') {
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          data: {
            key: 'e2e-inference-key-12345678901234567890123456789012',
          },
        }));
        return;
      }

      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        data: {
          items: [
            { id: 1, name: 'default', key: 'e2e-in**************9012', status: 1, remain_quota: 200, unlimited_quota: true, expired_time: -1 },
          ],
          total: 1,
        },
      }));
      return;
    }

    if (req.url === '/dashboard/billing/subscription') {
      res.writeHead(200);
      res.end(JSON.stringify({
        object: 'billing_subscription',
        hard_limit_usd: hardLimitUsd,
      }));
      return;
    }

    if (req.url === '/dashboard/billing/usage') {
      res.writeHead(200);
      res.end(JSON.stringify({
        object: 'list',
        total_usage: 4550,
      }));
      return;
    }

    if (req.url?.startsWith('/api/log/self')) {
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        data: {
          items: [
            {
              id: 11,
              created_at: 1710002000,
              model_name: 'gpt-4.1-mini',
              token_name: 'default',
              prompt_tokens: 12,
              completion_tokens: 6,
              quota: 120,
            },
          ],
        },
      }));
      return;
    }

    if (req.url === '/api/user/topup/info') {
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        data: {
          enable_online_topup: true,
          min_topup: 10,
          amount_options: [10, 20, 50],
          pay_methods: [
            { name: 'Alipay', type: 'alipay', min_topup: 10 },
          ],
        },
      }));
      return;
    }

    if (req.url === '/api/user/pay' && req.method === 'POST') {
      hardLimitUsd = 150.0;
      res.writeHead(200);
      res.end(JSON.stringify({
        message: 'success',
        data: {
          pid: '10001',
          out_trade_no: 'e2e-order-1',
          sign: 'mock-signature',
        },
        url: 'https://pay.example.com/submit',
      }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });

  const port = await new Promise<number>((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to start New API mock server'));
        return;
      }
      resolvePort(address.port);
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      });
    },
  };
}

async function launchClawXElectron(
  homeDir: string,
  userDataDir: string,
  newApiBaseUrl: string,
  options: LaunchElectronOptions = {},
): Promise<ElectronApplication> {
  const hostApiPort = await allocatePort();
  const electronEnv = process.platform === 'linux'
    ? { ELECTRON_DISABLE_SANDBOX: '1' }
    : {};
  return await electron.launch({
    executablePath: electronBinaryPath,
    args: [electronEntry],
    env: {
      ...process.env,
      ...electronEnv,
      HOME: homeDir,
      USERPROFILE: homeDir,
      APPDATA: join(homeDir, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(homeDir, 'AppData', 'Local'),
      XDG_CONFIG_HOME: join(homeDir, '.config'),
      CLAWX_E2E: '1',
      CLAWX_USER_DATA_DIR: userDataDir,
      ...(options.skipSetup ? { CLAWX_E2E_SKIP_SETUP: '1' } : {}),
      CLAWX_PORT_CLAWX_HOST_API: String(hostApiPort),
      CLAWX_NEW_API_BASE_URL: newApiBaseUrl,
    },
    timeout: 90_000,
  });
}

export const test = base.extend<ElectronFixtures>({
  homeDir: async ({ browserName: _browserName }, provideHomeDir) => {
    const homeDir = await mkdtemp(join(tmpdir(), 'clawx-e2e-home-'));
    await mkdir(join(homeDir, '.config'), { recursive: true });
    await mkdir(join(homeDir, 'AppData', 'Local'), { recursive: true });
    await mkdir(join(homeDir, 'AppData', 'Roaming'), { recursive: true });
    try {
      await provideHomeDir(homeDir);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  },

  userDataDir: async ({ browserName: _browserName }, provideUserDataDir) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'clawx-e2e-user-data-'));
    try {
      await provideUserDataDir(userDataDir);
    } finally {
      await rm(userDataDir, { recursive: true, force: true });
    }
  },

  launchElectronApp: async ({ homeDir, userDataDir }, provideLauncher) => {
    const newApiMockServer = await startNewApiMockServer();
    try {
      await provideLauncher(async (options?: LaunchElectronOptions) => await launchClawXElectron(
        homeDir,
        userDataDir,
        newApiMockServer.baseUrl,
        options,
      ));
    } finally {
      await newApiMockServer.close().catch(() => {});
    }
  },

  electronApp: async ({ launchElectronApp }, provideElectronApp) => {
    const app = await launchElectronApp();
    let appClosed = false;
    app.once('close', () => {
      appClosed = true;
    });

    try {
      await provideElectronApp(app);
    } finally {
      if (!appClosed) {
        await closeElectronApp(app);
      }
    }
  },

  page: async ({ electronApp }, providePage) => {
    const page = await getStableWindow(electronApp);
    await providePage(page);
  },
});

export async function completeSetup(page: Page): Promise<void> {
  await expect(page.getByTestId('setup-page')).toBeVisible();
  await page.getByTestId('setup-skip-button').click();
  await expect(page.getByTestId('main-layout')).toBeVisible();
}

export { closeElectronApp };
export { getStableWindow };
export { expect };
