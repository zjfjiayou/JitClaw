import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getResourcesDir } from './paths';

export const NEW_API_ACCOUNT_ID = 'new-api';
export const NEW_API_ACCESS_TOKEN_ID = 'new-api-access';
export const NEW_API_PROVIDER_LABEL = 'New API';
export const DEFAULT_NEW_API_ENDPOINTS = {
  models: '/v1/models',
  userSelfAccessToken: '/api/user/self/access-token',
  userSelf: '/api/user/self',
  tokenList: '/api/token/',
  logSelf: '/api/log/self',
  logSelfStat: '/api/log/self/stat',
  billingSubscription: '/dashboard/billing/subscription',
  billingUsage: '/dashboard/billing/usage',
  topupInfo: '/api/user/topup/info',
  topupPay: '/api/user/pay',
} as const;

export interface NewApiConfig {
  apiLabel: string;
  baseUrl: string;
  endpoints: {
    models: string;
    userSelfAccessToken: string;
    userSelf: string;
    tokenList: string;
    logSelf: string;
    logSelfStat: string;
    billingSubscription: string;
    billingUsage: string;
    topupInfo: string;
    topupPay: string;
  };
}

let cachedConfig: NewApiConfig | null = null;

export function resolveNewApiRuntimeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) return normalized;
  if (normalized.endsWith('/v1')) {
    return normalized;
  }
  if (normalized.endsWith('/chat/completions')) {
    return normalized.replace(/\/chat\/completions$/i, '');
  }
  return `${normalized}/v1`;
}

function getConfigPath(): string {
  const overridePath = process.env.CLAWX_NEW_API_CONFIG_PATH?.trim();
  if (overridePath) {
    return overridePath;
  }
  return join(getResourcesDir(), 'new-api.json');
}

function normalizePath(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function applyEnvironmentOverrides(config: NewApiConfig): NewApiConfig {
  const baseUrl = process.env.CLAWX_NEW_API_BASE_URL?.trim() || config.baseUrl;

  return {
    apiLabel: process.env.CLAWX_NEW_API_LABEL?.trim() || config.apiLabel,
    baseUrl,
    endpoints: {
      models: normalizePath(process.env.CLAWX_NEW_API_MODELS_PATH, config.endpoints.models),
      userSelfAccessToken: normalizePath(
        process.env.CLAWX_NEW_API_USER_SELF_ACCESS_TOKEN_PATH,
        config.endpoints.userSelfAccessToken,
      ),
      userSelf: normalizePath(process.env.CLAWX_NEW_API_USER_SELF_PATH, config.endpoints.userSelf),
      tokenList: normalizePath(process.env.CLAWX_NEW_API_TOKEN_LIST_PATH, config.endpoints.tokenList),
      logSelf: normalizePath(process.env.CLAWX_NEW_API_LOG_SELF_PATH, config.endpoints.logSelf),
      logSelfStat: normalizePath(process.env.CLAWX_NEW_API_LOG_SELF_STAT_PATH, config.endpoints.logSelfStat),
      billingSubscription: normalizePath(process.env.CLAWX_NEW_API_BILLING_SUBSCRIPTION_PATH, config.endpoints.billingSubscription),
      billingUsage: normalizePath(process.env.CLAWX_NEW_API_BILLING_USAGE_PATH, config.endpoints.billingUsage),
      topupInfo: normalizePath(process.env.CLAWX_NEW_API_TOPUP_INFO_PATH, config.endpoints.topupInfo),
      topupPay: normalizePath(process.env.CLAWX_NEW_API_TOPUP_PAY_PATH, config.endpoints.topupPay),
    },
  };
}

export async function getNewApiConfig(): Promise<NewApiConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const raw = JSON.parse(readFileSync(getConfigPath(), 'utf8')) as Partial<NewApiConfig>;
  const normalized: NewApiConfig = applyEnvironmentOverrides({
    apiLabel: raw.apiLabel?.trim() || NEW_API_PROVIDER_LABEL,
    baseUrl: raw.baseUrl?.trim() || '',
    endpoints: {
      models: normalizePath(raw.endpoints?.models, DEFAULT_NEW_API_ENDPOINTS.models),
      userSelfAccessToken: normalizePath(
        raw.endpoints?.userSelfAccessToken,
        DEFAULT_NEW_API_ENDPOINTS.userSelfAccessToken,
      ),
      userSelf: normalizePath(raw.endpoints?.userSelf, DEFAULT_NEW_API_ENDPOINTS.userSelf),
      tokenList: normalizePath(raw.endpoints?.tokenList, DEFAULT_NEW_API_ENDPOINTS.tokenList),
      logSelf: normalizePath(raw.endpoints?.logSelf, DEFAULT_NEW_API_ENDPOINTS.logSelf),
      logSelfStat: normalizePath(raw.endpoints?.logSelfStat, DEFAULT_NEW_API_ENDPOINTS.logSelfStat),
      billingSubscription: normalizePath(raw.endpoints?.billingSubscription, DEFAULT_NEW_API_ENDPOINTS.billingSubscription),
      billingUsage: normalizePath(raw.endpoints?.billingUsage, DEFAULT_NEW_API_ENDPOINTS.billingUsage),
      topupInfo: normalizePath(raw.endpoints?.topupInfo, DEFAULT_NEW_API_ENDPOINTS.topupInfo),
      topupPay: normalizePath(raw.endpoints?.topupPay, DEFAULT_NEW_API_ENDPOINTS.topupPay),
    },
  });

  if (!normalized.baseUrl) {
    throw new Error('New API baseUrl is missing in bundled configuration');
  }

  cachedConfig = normalized;
  return normalized;
}

export function resetNewApiConfigCache(): void {
  cachedConfig = null;
}
