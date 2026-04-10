import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExistsSync,
  mockCpSync,
  mockCopyFileSync,
  mockStatSync,
  mockMkdirSync,
  mockRmSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockReaddirSync,
  mockRealpathSync,
  mockLoggerWarn,
  mockLoggerInfo,
  mockHomedir,
  mockApp,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockCpSync: vi.fn(),
  mockCopyFileSync: vi.fn(),
  mockStatSync: vi.fn(() => ({ isDirectory: () => false })),
  mockMkdirSync: vi.fn(),
  mockRmSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockRealpathSync: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockHomedir: vi.fn(() => '/home/test'),
  mockApp: {
    isPackaged: true,
    getAppPath: vi.fn(() => '/mock/app'),
  },
}));

const ORIGINAL_PLATFORM_DESCRIPTOR = Object.getOwnPropertyDescriptor(process, 'platform');

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  const mocked = {
    ...actual,
    existsSync: mockExistsSync,
    cpSync: mockCpSync,
    copyFileSync: mockCopyFileSync,
    statSync: mockStatSync,
    mkdirSync: mockMkdirSync,
    rmSync: mockRmSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    readdirSync: mockReaddirSync,
    realpathSync: mockRealpathSync,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readdir: vi.fn(),
    stat: vi.fn(),
    copyFile: vi.fn(),
    mkdir: vi.fn(),
  };
});

vi.mock('node:os', () => ({
  homedir: () => mockHomedir(),
  default: {
    homedir: () => mockHomedir(),
  },
}));

vi.mock('electron', () => ({
  app: mockApp,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    warn: mockLoggerWarn,
    info: mockLoggerInfo,
  },
}));

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
}

describe('plugin installer diagnostics', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockApp.isPackaged = true;
    mockHomedir.mockReturnValue('/home/test');
    setPlatform('linux');

    mockExistsSync.mockReturnValue(false);
    mockCpSync.mockImplementation(() => undefined);
    mockMkdirSync.mockImplementation(() => undefined);
    mockRmSync.mockImplementation(() => undefined);
    mockReadFileSync.mockReturnValue('{}');
    mockWriteFileSync.mockImplementation(() => undefined);
    mockReaddirSync.mockReturnValue([]);
    mockRealpathSync.mockImplementation((input: string) => input);
  });

  afterEach(() => {
    if (ORIGINAL_PLATFORM_DESCRIPTOR) {
      Object.defineProperty(process, 'platform', ORIGINAL_PLATFORM_DESCRIPTOR);
    }
  });

  it('returns source-missing warning when bundled mirror cannot be found', async () => {
    const { ensurePluginInstalled } = await import('@electron/utils/plugin-install');
    const result = ensurePluginInstalled('wecom', ['/bundle/wecom'], 'WeCom');

    expect(result.installed).toBe(false);
    expect(result.warning).toContain('Bundled WeCom plugin mirror not found');
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('retries once on Windows and logs diagnostic details when bundled copy fails', async () => {
    setPlatform('win32');
    mockHomedir.mockReturnValue('C:\\Users\\test');

    const sourceDir = 'C:\\Program Files\\ClawX\\resources\\openclaw-plugins\\wecom';
    const sourceManifestSuffix = 'Program Files\\ClawX\\resources\\openclaw-plugins\\wecom\\openclaw.plugin.json';

    mockExistsSync.mockImplementation((input: string) => String(input).includes(sourceManifestSuffix));
    // On win32, cpSyncSafe uses _copyDirSyncRecursive (readdirSync) instead of cpSync.
    // Simulate copy failure by making readdirSync throw during directory traversal.
    mockReaddirSync.mockImplementation((_path: string, opts?: unknown) => {
      if (opts && typeof opts === 'object' && 'withFileTypes' in (opts as Record<string, unknown>)) {
        const error = new Error('path too long') as NodeJS.ErrnoException;
        error.code = 'ENAMETOOLONG';
        throw error;
      }
      return [];
    });

    const { ensurePluginInstalled } = await import('@electron/utils/plugin-install');
    const result = ensurePluginInstalled('wecom', [sourceDir], 'WeCom');

    expect(result).toEqual({
      installed: false,
      warning: 'Failed to install bundled WeCom plugin mirror',
    });

    // On win32, cpSyncSafe walks the directory via readdirSync (with withFileTypes)
    const copyAttempts = mockReaddirSync.mock.calls.filter(
      (call: unknown[]) => {
        const opts = call[1];
        return opts && typeof opts === 'object' && 'withFileTypes' in (opts as Record<string, unknown>);
      },
    );
    expect(copyAttempts).toHaveLength(2); // initial + 1 retry
    const firstSrcPath = String(copyAttempts[0][0]);
    expect(firstSrcPath.startsWith('\\\\?\\')).toBe(true);

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      '[plugin] Bundled mirror install failed for WeCom',
      expect.objectContaining({
        pluginDirName: 'wecom',
        pluginLabel: 'WeCom',
        sourceDir,
        platform: 'win32',
        attempts: [
          expect.objectContaining({ attempt: 1, code: 'ENAMETOOLONG' }),
          expect.objectContaining({ attempt: 2, code: 'ENAMETOOLONG' }),
        ],
      }),
    );
  });

  it('logs EPERM diagnostics with source and target paths', async () => {
    setPlatform('win32');
    mockHomedir.mockReturnValue('C:\\Users\\test');

    const sourceDir = 'C:\\Program Files\\ClawX\\resources\\openclaw-plugins\\wecom';
    const sourceManifestSuffix = 'Program Files\\ClawX\\resources\\openclaw-plugins\\wecom\\openclaw.plugin.json';

    mockExistsSync.mockImplementation((input: string) => String(input).includes(sourceManifestSuffix));
    // On win32, cpSyncSafe uses _copyDirSyncRecursive (readdirSync) instead of cpSync.
    mockReaddirSync.mockImplementation((_path: string, opts?: unknown) => {
      if (opts && typeof opts === 'object' && 'withFileTypes' in (opts as Record<string, unknown>)) {
        const error = new Error('access denied') as NodeJS.ErrnoException;
        error.code = 'EPERM';
        throw error;
      }
      return [];
    });

    const { ensurePluginInstalled } = await import('@electron/utils/plugin-install');
    const result = ensurePluginInstalled('wecom', [sourceDir], 'WeCom');

    expect(result.installed).toBe(false);
    expect(result.warning).toBe('Failed to install bundled WeCom plugin mirror');

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      '[plugin] Bundled mirror install failed for WeCom',
      expect.objectContaining({
        sourceDir,
        targetDir: expect.stringContaining('.openclaw/extensions/wecom'),
        platform: 'win32',
        attempts: [
          expect.objectContaining({ attempt: 1, code: 'EPERM' }),
          expect.objectContaining({ attempt: 2, code: 'EPERM' }),
        ],
      }),
    );
  });

  it('prefers newer dev node_modules plugins over stale bundled mirrors in dev mode', async () => {
    mockApp.isPackaged = false;

    const bundledDir = '/bundle/dingtalk';
    const bundledManifest = `${bundledDir}/openclaw.plugin.json`;
    const bundledPkg = `${bundledDir}/package.json`;
    const npmDir = `${process.cwd()}/node_modules/@soimy/dingtalk`;
    const npmManifest = `${npmDir}/openclaw.plugin.json`;
    const npmPkg = `${npmDir}/package.json`;
    const targetManifest = '/home/test/.openclaw/extensions/dingtalk/openclaw.plugin.json';
    const targetPkg = '/home/test/.openclaw/extensions/dingtalk/package.json';

    mockExistsSync.mockImplementation((input: string) => {
      const normalized = String(input);
      return normalized === bundledManifest
        || normalized === npmManifest
        || normalized === targetManifest;
    });
    mockReadFileSync.mockImplementation((input: string) => {
      const normalized = String(input);
      if (normalized === bundledPkg) {
        return JSON.stringify({ name: '@soimy/dingtalk', version: '3.5.1' });
      }
      if (normalized === npmPkg) {
        return JSON.stringify({ name: '@soimy/dingtalk', version: '3.5.3', peerDependencies: {} });
      }
      if (normalized === targetPkg) {
        return JSON.stringify({ name: '@soimy/dingtalk', version: '3.5.1', peerDependencies: {} });
      }
      if (normalized.endsWith('openclaw.plugin.json')) {
        return JSON.stringify({ id: 'dingtalk' });
      }
      return '{}';
    });

    const { ensurePluginInstalled } = await import('@electron/utils/plugin-install');
    const result = ensurePluginInstalled('dingtalk', [bundledDir], 'DingTalk');

    expect(result).toEqual({ installed: true });
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      '[plugin] Preferring dev/node_modules source for dingtalk: 3.5.1 -> 3.5.3',
    );
    expect(mockCpSync).toHaveBeenCalledWith(
      expect.stringContaining('/node_modules/@soimy/dingtalk'),
      expect.stringContaining('/home/test/.openclaw/extensions/dingtalk'),
      expect.objectContaining({ recursive: true, dereference: true }),
    );
  });

  it('keeps a newer installed plugin instead of downgrading to an older bundled mirror', async () => {
    const bundledDir = '/bundle/dingtalk';
    const bundledManifest = `${bundledDir}/openclaw.plugin.json`;
    const bundledPkg = `${bundledDir}/package.json`;
    const targetManifest = '/home/test/.openclaw/extensions/dingtalk/openclaw.plugin.json';
    const targetPkg = '/home/test/.openclaw/extensions/dingtalk/package.json';

    mockExistsSync.mockImplementation((input: string) => {
      const normalized = String(input);
      return normalized === bundledManifest || normalized === targetManifest;
    });
    mockReadFileSync.mockImplementation((input: string) => {
      const normalized = String(input);
      if (normalized === bundledPkg) {
        return JSON.stringify({ name: '@soimy/dingtalk', version: '3.5.1' });
      }
      if (normalized === targetPkg) {
        return JSON.stringify({ name: '@soimy/dingtalk', version: '3.5.3', peerDependencies: {} });
      }
      if (normalized.endsWith('openclaw.plugin.json')) {
        return JSON.stringify({ id: 'dingtalk' });
      }
      return '{}';
    });

    const { ensurePluginInstalled } = await import('@electron/utils/plugin-install');
    const result = ensurePluginInstalled('dingtalk', [bundledDir], 'DingTalk');

    expect(result).toEqual({ installed: true });
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      '[plugin] Keeping newer installed DingTalk plugin: 3.5.3 > 3.5.1',
    );
  });
});
