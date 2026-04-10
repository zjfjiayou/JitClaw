import { app } from 'electron';
import path from 'path';
import { existsSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

function fsPath(filePath: string): string {
  if (process.platform !== 'win32') return filePath;
  if (!filePath) return filePath;
  if (filePath.startsWith('\\\\?\\')) return filePath;
  const windowsPath = filePath.replace(/\//g, '\\');
  if (!path.win32.isAbsolute(windowsPath)) return windowsPath;
  if (windowsPath.startsWith('\\\\')) {
    return `\\\\?\\UNC\\${windowsPath.slice(2)}`;
  }
  return `\\\\?\\${windowsPath}`;
}
import { getAllSettings } from '../utils/store';
import { getApiKey, getDefaultProvider, getProvider } from '../utils/secure-storage';
import { getProviderEnvVar, getKeyableProviderTypes } from '../utils/provider-registry';
import { getOpenClawDir, getOpenClawEntryPath, isOpenClawPresent } from '../utils/paths';
import { getUvMirrorEnv } from '../utils/uv-env';
import { cleanupDanglingWeChatPluginState, listConfiguredChannels, readOpenClawConfig } from '../utils/channel-config';
import { syncGatewayTokenToConfig, syncBrowserConfigToOpenClaw, syncSessionIdleMinutesToOpenClaw, sanitizeOpenClawConfig } from '../utils/openclaw-auth';
import { buildProxyEnv, resolveProxySettings } from '../utils/proxy';
import { syncProxyConfigToOpenClaw } from '../utils/openclaw-proxy';
import { logger } from '../utils/logger';
import { prependPathEntry } from '../utils/env-path';
import { buildCandidateSources, ensurePluginInstalled } from '../utils/plugin-install';
import { stripSystemdSupervisorEnv } from './config-sync-env';


export interface GatewayLaunchContext {
  appSettings: Awaited<ReturnType<typeof getAllSettings>>;
  openclawDir: string;
  entryScript: string;
  gatewayArgs: string[];
  forkEnv: Record<string, string | undefined>;
  mode: 'dev' | 'packaged';
  binPathExists: boolean;
  loadedProviderKeyCount: number;
  proxySummary: string;
  channelStartupSummary: string;
}

// ── Auto-upgrade bundled plugins on startup ──────────────────────

const CHANNEL_PLUGIN_MAP: Record<string, { dirName: string; label: string }> = {
  dingtalk: { dirName: 'dingtalk', label: 'DingTalk' },
  wecom: { dirName: 'wecom', label: 'WeCom' },
  feishu: { dirName: 'feishu-openclaw-plugin', label: 'Feishu' },
  'openclaw-weixin': { dirName: 'openclaw-weixin', label: 'WeChat' },
};

/**
 * OpenClaw 3.22+ ships Discord, Telegram, and other channels as built-in
 * extensions.  If a previous ClawX version copied one of these into
 * ~/.openclaw/extensions/, the broken copy overrides the working built-in
 * plugin and must be removed.
 */
const BUILTIN_CHANNEL_EXTENSIONS = ['discord', 'telegram', 'qqbot'];

function cleanupStaleBuiltInExtensions(): void {
  for (const ext of BUILTIN_CHANNEL_EXTENSIONS) {
    const extDir = join(homedir(), '.openclaw', 'extensions', ext);
    if (existsSync(fsPath(extDir))) {
      logger.info(`[plugin] Removing stale built-in extension copy: ${ext}`);
      try {
        rmSync(fsPath(extDir), { recursive: true, force: true });
      } catch (err) {
        logger.warn(`[plugin] Failed to remove stale extension ${ext}:`, err);
      }
    }
  }
}

/**
 * Auto-upgrade all configured channel plugins before Gateway start.
 * Uses the same version-aware source preference as the startup installer.
 */
function ensureConfiguredPluginsUpgraded(configuredChannels: string[]): void {
  for (const channelType of configuredChannels) {
    const pluginInfo = CHANNEL_PLUGIN_MAP[channelType];
    if (!pluginInfo) continue;
    const { dirName, label } = pluginInfo;
    const result = ensurePluginInstalled(dirName, buildCandidateSources(dirName), label);
    if (result.warning) {
      logger.warn(`[plugin] ${label}: ${result.warning}`);
    }
  }
}

// ── Pre-launch sync ──────────────────────────────────────────────

export async function syncGatewayConfigBeforeLaunch(
  appSettings: Awaited<ReturnType<typeof getAllSettings>>,
): Promise<void> {
  await syncProxyConfigToOpenClaw(appSettings, { preserveExistingWhenDisabled: true });

  try {
    await sanitizeOpenClawConfig();
  } catch (err) {
    logger.warn('Failed to sanitize openclaw.json:', err);
  }

  try {
    await cleanupDanglingWeChatPluginState();
  } catch (err) {
    logger.warn('Failed to clean dangling WeChat plugin state before launch:', err);
  }

  // Remove stale copies of built-in extensions (Discord, Telegram) that
  // override OpenClaw's working built-in plugins and break channel loading.
  try {
    cleanupStaleBuiltInExtensions();
  } catch (err) {
    logger.warn('Failed to clean stale built-in extensions:', err);
  }

  // Auto-upgrade installed plugins before Gateway starts so that
  // the plugin manifest ID matches what sanitize wrote to the config.
  try {
    const configuredChannels = await listConfiguredChannels();

    // Also ensure plugins referenced in plugins.allow are installed even if
    // they have no channels.X section yet (e.g. qqbot added via plugins.allow
    // but never fully saved through ClawX UI).
    try {
      const rawCfg = await readOpenClawConfig();
      const allowList = Array.isArray(rawCfg.plugins?.allow) ? (rawCfg.plugins!.allow as string[]) : [];
      // Build reverse maps: dirName → channelType AND known manifest IDs → channelType
      const pluginIdToChannel: Record<string, string> = {};
      for (const [channelType, info] of Object.entries(CHANNEL_PLUGIN_MAP)) {
        pluginIdToChannel[info.dirName] = channelType;
      }
      // Known manifest IDs that differ from their dirName/channelType

      pluginIdToChannel['openclaw-lark'] = 'feishu';
      pluginIdToChannel['feishu-openclaw-plugin'] = 'feishu';

      for (const pluginId of allowList) {
        const channelType = pluginIdToChannel[pluginId] ?? pluginId;
        if (CHANNEL_PLUGIN_MAP[channelType] && !configuredChannels.includes(channelType)) {
          configuredChannels.push(channelType);
        }
      }

    } catch (err) {
      logger.warn('[plugin] Failed to augment channel list from plugins.allow:', err);
    }

    ensureConfiguredPluginsUpgraded(configuredChannels);
  } catch (err) {
    logger.warn('Failed to auto-upgrade plugins:', err);
  }

  try {
    await syncGatewayTokenToConfig(appSettings.gatewayToken);
  } catch (err) {
    logger.warn('Failed to sync gateway token to openclaw.json:', err);
  }

  try {
    await syncBrowserConfigToOpenClaw();
  } catch (err) {
    logger.warn('Failed to sync browser config to openclaw.json:', err);
  }

  try {
    await syncSessionIdleMinutesToOpenClaw();
  } catch (err) {
    logger.warn('Failed to sync session idle minutes to openclaw.json:', err);
  }
}

async function loadProviderEnv(): Promise<{ providerEnv: Record<string, string>; loadedProviderKeyCount: number }> {
  const providerEnv: Record<string, string> = {};
  const providerTypes = getKeyableProviderTypes();
  let loadedProviderKeyCount = 0;

  try {
    const defaultProviderId = await getDefaultProvider();
    if (defaultProviderId) {
      const defaultProvider = await getProvider(defaultProviderId);
      const defaultProviderType = defaultProvider?.type;
      const defaultProviderKey = await getApiKey(defaultProviderId);
      if (defaultProviderType && defaultProviderKey) {
        const envVar = getProviderEnvVar(defaultProviderType);
        if (envVar) {
          providerEnv[envVar] = defaultProviderKey;
          loadedProviderKeyCount++;
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to load default provider key for environment injection:', err);
  }

  for (const providerType of providerTypes) {
    try {
      const key = await getApiKey(providerType);
      if (key) {
        const envVar = getProviderEnvVar(providerType);
        if (envVar) {
          providerEnv[envVar] = key;
          loadedProviderKeyCount++;
        }
      }
    } catch (err) {
      logger.warn(`Failed to load API key for ${providerType}:`, err);
    }
  }

  return { providerEnv, loadedProviderKeyCount };
}

async function resolveChannelStartupPolicy(): Promise<{
  skipChannels: boolean;
  channelStartupSummary: string;
}> {
  try {
    const configuredChannels = await listConfiguredChannels();
    if (configuredChannels.length === 0) {
      return {
        skipChannels: true,
        channelStartupSummary: 'skipped(no configured channels)',
      };
    }

    return {
      skipChannels: false,
      channelStartupSummary: `enabled(${configuredChannels.join(',')})`,
    };
  } catch (error) {
    logger.warn('Failed to determine configured channels for gateway launch:', error);
    return {
      skipChannels: false,
      channelStartupSummary: 'enabled(unknown)',
    };
  }
}

export async function prepareGatewayLaunchContext(port: number): Promise<GatewayLaunchContext> {
  const openclawDir = getOpenClawDir();
  const entryScript = getOpenClawEntryPath();

  if (!isOpenClawPresent()) {
    throw new Error(`OpenClaw package not found at: ${openclawDir}`);
  }

  const appSettings = await getAllSettings();
  await syncGatewayConfigBeforeLaunch(appSettings);

  if (!existsSync(entryScript)) {
    throw new Error(`OpenClaw entry script not found at: ${entryScript}`);
  }

  const gatewayArgs = ['gateway', '--port', String(port), '--token', appSettings.gatewayToken, '--allow-unconfigured'];
  const mode = app.isPackaged ? 'packaged' : 'dev';

  const platform = process.platform;
  const arch = process.arch;
  const target = `${platform}-${arch}`;
  const binPath = app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(process.cwd(), 'resources', 'bin', target);
  const binPathExists = existsSync(binPath);

  const { providerEnv, loadedProviderKeyCount } = await loadProviderEnv();
  const { skipChannels, channelStartupSummary } = await resolveChannelStartupPolicy();
  const uvEnv = await getUvMirrorEnv();
  const proxyEnv = buildProxyEnv(appSettings);
  const resolvedProxy = resolveProxySettings(appSettings);
  const proxySummary = appSettings.proxyEnabled
    ? `http=${resolvedProxy.httpProxy || '-'}, https=${resolvedProxy.httpsProxy || '-'}, all=${resolvedProxy.allProxy || '-'}`
    : 'disabled';

  const { NODE_OPTIONS: _nodeOptions, ...baseEnv } = process.env;
  const baseEnvRecord = baseEnv as Record<string, string | undefined>;
  const baseEnvPatched = binPathExists
    ? prependPathEntry(baseEnvRecord, binPath).env
    : baseEnvRecord;
  const forkEnv: Record<string, string | undefined> = {
    ...stripSystemdSupervisorEnv(baseEnvPatched),
    ...providerEnv,
    ...uvEnv,
    ...proxyEnv,
    OPENCLAW_GATEWAY_TOKEN: appSettings.gatewayToken,
    OPENCLAW_SKIP_CHANNELS: skipChannels ? '1' : '',
    CLAWDBOT_SKIP_CHANNELS: skipChannels ? '1' : '',
    OPENCLAW_NO_RESPAWN: '1',
  };

  return {
    appSettings,
    openclawDir,
    entryScript,
    gatewayArgs,
    forkEnv,
    mode,
    binPathExists,
    loadedProviderKeyCount,
    proxySummary,
    channelStartupSummary,
  };
}
