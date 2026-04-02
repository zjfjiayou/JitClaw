import { proxyAwareFetch } from '../utils/proxy-fetch';
import { getNewApiConfig } from '../utils/new-api-config';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface NewApiUserSelf {
  id: number;
  username: string;
  quota: number;
  usedQuota: number;
  requestCount: number;
}

export interface NewApiToken {
  id: number;
  name: string;
  key: string;
  group: string;
  status: number;
  remainQuota: number;
  unlimitedQuota: boolean;
  expiredTime: number;
}

export interface NewApiUsageLogEntry {
  id: string;
  createdAt?: number;
  modelName?: string;
  tokenName?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  quota?: number;
}

export interface NewApiUsageOverview {
  account: {
    username?: string;
    quota?: number;
    usedQuota?: number;
    requestCount?: number;
  };
  billing: {
    hardLimitUsd?: number;
    totalUsageUsd?: number;
  } | null;
  logs: NewApiUsageLogEntry[];
}

export interface NewApiPayMethod {
  name: string;
  type: string;
  color?: string;
  minTopup?: number;
}

export interface NewApiTopupInfo {
  enabled: boolean;
  minTopup: number;
  amountOptions: number[];
  payMethods: NewApiPayMethod[];
}

export interface NewApiEpayRequestResult {
  paymentUrl: string;
  formParams: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function resolvePayloadData<T>(payload: unknown): T {
  const record = asRecord(payload);
  if (record && 'data' in record) {
    return record.data as T;
  }
  return payload as T;
}

function resolvePayloadRecord(payload: unknown): Record<string, unknown> {
  return asRecord(resolvePayloadData<unknown>(payload)) ?? {};
}

function resolvePayloadItems(payload: unknown): unknown[] {
  const record = asRecord(payload);
  if (Array.isArray(record?.items)) {
    return record.items as unknown[];
  }
  return Array.isArray(payload) ? payload as unknown[] : [];
}

function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}


interface FetchOptions {
  extraHeaders?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: unknown;
}

async function fetchNewApiJson<T>(
  authToken: string,
  path: string,
  options?: FetchOptions,
): Promise<T> {
  const config = await getNewApiConfig();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
    ...options?.extraHeaders,
  };

  const response = await proxyAwareFetch(joinUrl(config.baseUrl, path), {
    method: options?.method || 'GET',
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json() as { error?: { message?: string } | string; message?: string };
      if (typeof payload?.error === 'string') {
        message = payload.error;
      } else if (payload?.error && typeof payload.error.message === 'string') {
        message = payload.error.message;
      } else if (typeof payload?.message === 'string' && payload.message) {
        message = payload.message;
      }
    } catch {
      // Ignore body parse failures.
    }
    throw new Error(message);
  }

  return await response.json() as T;
}

function buildUserSelfPaths(config: Awaited<ReturnType<typeof getNewApiConfig>>): string[] {
  const paths = [
    config.endpoints.userSelfAccessToken,
    config.endpoints.userSelf,
  ];
  return [...new Set(paths.filter((path) => typeof path === 'string' && path.trim()))];
}

function createUserHeader(userId: number): Record<string, string> {
  return { 'New-Api-User': String(userId) };
}

// ---------------------------------------------------------------------------
// getUserSelf — account-level info (UserAuth)
// ---------------------------------------------------------------------------

export async function getUserSelf(accessToken: string): Promise<NewApiUserSelf> {
  const config = await getNewApiConfig();
  let payload: unknown = null;
  let lastError: unknown = null;

  for (const path of buildUserSelfPaths(config)) {
    try {
      payload = await fetchNewApiJson<unknown>(accessToken, path);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  const data = resolvePayloadRecord(payload);

  const id = asNumber(data.id);
  if (id === undefined) {
    throw new Error('Invalid user response: missing id');
  }

  return {
    id,
    username: asString(data.username) ?? asString(data.display_name) ?? '',
    quota: asNumber(data.quota) ?? 0,
    usedQuota: asNumber(data.used_quota) ?? asNumber(data.usedQuota) ?? 0,
    requestCount: asNumber(data.request_count) ?? asNumber(data.requestCount) ?? 0,
  };
}


// ---------------------------------------------------------------------------
// listNewApiTokens — fetch all user tokens (UserAuth)
// ---------------------------------------------------------------------------

const TOKEN_PAGE_SIZE = 100;
const TOKEN_MAX_ITEMS = 500;

export async function listNewApiTokens(
  accessToken: string,
  userId: number,
): Promise<NewApiToken[]> {
  const config = await getNewApiConfig();
  const userHeader = createUserHeader(userId);
  const allTokens: NewApiToken[] = [];

  for (let page = 1; allTokens.length < TOKEN_MAX_ITEMS; page++) {
    const sep = config.endpoints.tokenList.includes('?') ? '&' : '?';
    const path = `${config.endpoints.tokenList}${sep}p=${page}&page_size=${TOKEN_PAGE_SIZE}`;
    const payload = await fetchNewApiJson<unknown>(accessToken, path, { extraHeaders: userHeader });
    const data = resolvePayloadData<unknown>(payload);

    // Handle both { items: [...], total } and plain array responses
    const items = resolvePayloadItems(data);

    for (const item of items) {
      const rec = asRecord(item);
      if (!rec) continue;
      const key = asString(rec.key);
      if (!key) continue;

      allTokens.push({
        id: asNumber(rec.id) ?? 0,
        name: asString(rec.name) ?? '',
        key,
        group: asString(rec.group) ?? 'default',
        status: asNumber(rec.status) ?? 0,
        remainQuota: asNumber(rec.remain_quota) ?? asNumber(rec.remainQuota) ?? 0,
        unlimitedQuota: Boolean(rec.unlimited_quota ?? rec.unlimitedQuota),
        expiredTime: asNumber(rec.expired_time) ?? asNumber(rec.expiredTime) ?? -1,
      });
    }

    const total = asNumber(asRecord(data)?.total);
    if (items.length < TOKEN_PAGE_SIZE || (total !== undefined && allTokens.length >= total)) {
      break;
    }
  }

  return allTokens;
}

function buildTokenKeyPath(tokenListPath: string, tokenId: number): string {
  return `${tokenListPath.replace(/\/+$/, '')}/${tokenId}/key`;
}

async function getNewApiTokenKey(
  accessToken: string,
  userId: number,
  tokenId: number,
): Promise<string> {
  const config = await getNewApiConfig();
  const payload = await fetchNewApiJson<unknown>(
    accessToken,
    buildTokenKeyPath(config.endpoints.tokenList, tokenId),
    {
      method: 'POST',
      extraHeaders: createUserHeader(userId),
    },
  );
  const data = resolvePayloadRecord(payload);
  const key = asString(data.key);
  if (!key) {
    throw new Error(`Invalid token key response for token ${tokenId}`);
  }
  return key;
}

function isUsableToken(token: NewApiToken, now: number): boolean {
  const hasQuota = token.unlimitedQuota || token.remainQuota > 0;
  const notExpired = token.expiredTime === -1 || token.expiredTime * 1000 > now;
  return token.status === 1 && hasQuota && notExpired;
}

function compareTokensByPriority(a: NewApiToken, b: NewApiToken): number {
  if (a.unlimitedQuota !== b.unlimitedQuota) {
    return a.unlimitedQuota ? -1 : 1;
  }
  return b.remainQuota - a.remainQuota;
}


// ---------------------------------------------------------------------------
// pickBestApiKey — select a usable token and fetch its full key
// ---------------------------------------------------------------------------

export async function pickBestApiKey(
  accessToken: string,
): Promise<{ apiKey: string; tokenName: string } | null> {
  const user = await getUserSelf(accessToken);
  const tokens = await listNewApiTokens(accessToken, user.id);
  const now = Date.now();
  const selectedToken = [...tokens]
    .filter((token) => isUsableToken(token, now))
    .sort(compareTokensByPriority)[0];

  if (!selectedToken) {
    return null;
  }

  const apiKey = await getNewApiTokenKey(accessToken, user.id, selectedToken.id);
  return { apiKey, tokenName: selectedToken.name };
}

// ---------------------------------------------------------------------------
// getNewApiUsageOverview — account billing + user logs
// ---------------------------------------------------------------------------

function normalizeLogEntry(item: unknown): NewApiUsageLogEntry | null {
  const record = asRecord(item);
  const id = asString(record?.id) || String(asNumber(record?.id) ?? '');
  if (!id) return null;

  const promptTokens = asNumber(record?.prompt_tokens) ?? asNumber(record?.promptTokens);
  const completionTokens = asNumber(record?.completion_tokens) ?? asNumber(record?.completionTokens);
  const explicitTotal = asNumber(record?.total_tokens) ?? asNumber(record?.totalTokens);

  return {
    id,
    createdAt: asNumber(record?.created_at) ?? asNumber(record?.createdAt),
    modelName: asString(record?.model_name) ?? asString(record?.modelName),
    tokenName: asString(record?.token_name) ?? asString(record?.tokenName),
    promptTokens,
    completionTokens,
    totalTokens: explicitTotal ?? ((promptTokens ?? 0) + (completionTokens ?? 0)),
    quota: asNumber(record?.quota),
  };
}

export async function getNewApiUsageOverview(
  accessToken: string | null,
  inferenceKey: string | null,
): Promise<NewApiUsageOverview> {
  const config = await getNewApiConfig();
  const user = accessToken
    ? await getUserSelf(accessToken).catch(() => null)
    : null;
  const userHeader = user ? { 'New-Api-User': String(user.id) } : undefined;

  // Billing endpoints use TokenAuth (inference key)
  const billingPromise = inferenceKey
    ? Promise.all([
        fetchNewApiJson<unknown>(inferenceKey, config.endpoints.billingSubscription).catch(() => null),
        fetchNewApiJson<unknown>(inferenceKey, config.endpoints.billingUsage).catch(() => null),
      ])
    : Promise.resolve([null, null] as const);

  // Log endpoints use UserAuth (access token) — type=2 = consumption logs
  const logSep = config.endpoints.logSelf.includes('?') ? '&' : '?';
  const logPath = `${config.endpoints.logSelf}${logSep}p=1&page_size=20&type=2`;
  const logPromise = accessToken && userHeader
    ? fetchNewApiJson<unknown>(accessToken, logPath, { extraHeaders: userHeader }).catch(() => null)
    : Promise.resolve(null);

  const [[subPayload, usagePayload], logPayload] = await Promise.all([billingPromise, logPromise]);

  // Parse billing
  let billing: NewApiUsageOverview['billing'] = null;
  if (subPayload || usagePayload) {
    const subRecord = asRecord(subPayload) ?? {};
    const usageRecord = asRecord(usagePayload) ?? {};
    const hardLimit = asNumber(subRecord.hard_limit_usd)
      ?? asNumber(subRecord.system_hard_limit_usd);
    const totalUsageRaw = asNumber(usageRecord.total_usage);
    billing = {
      hardLimitUsd: hardLimit,
      totalUsageUsd: totalUsageRaw !== undefined ? totalUsageRaw / 100 : undefined,
    };
  }

  // Parse logs
  const logData = logPayload ? resolvePayloadData<unknown>(logPayload) : null;
  const logItems = resolvePayloadItems(logData);
  const logs = logItems
    .map(normalizeLogEntry)
    .filter((item): item is NewApiUsageLogEntry => Boolean(item));

  return {
    account: {
      username: user?.username,
      quota: user?.quota,
      usedQuota: user?.usedQuota,
      requestCount: user?.requestCount,
    },
    billing,
    logs,
  };
}

function normalizePayMethod(item: unknown): NewApiPayMethod | null {
  const record = asRecord(item);
  const type = asString(record?.type);
  const name = asString(record?.name);
  if (!type || !name) {
    return null;
  }

  const normalizedType = type.toLowerCase();
  if (normalizedType === 'stripe' || normalizedType === 'creem' || normalizedType === 'waffo') {
    return null;
  }

  return {
    name,
    type,
    color: asString(record?.color),
    minTopup: asNumber(record?.min_topup) ?? asNumber(record?.minTopup),
  };
}

function normalizeAmountOptions(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asNumber(item))
    .filter((item): item is number => item !== undefined);
}

// ---------------------------------------------------------------------------
// getNewApiTopupInfo — online top-up config (UserAuth)
// ---------------------------------------------------------------------------

export async function getNewApiTopupInfo(accessToken: string): Promise<NewApiTopupInfo> {
  const config = await getNewApiConfig();
  const user = await getUserSelf(accessToken);
  const payload = await fetchNewApiJson<unknown>(
    accessToken,
    config.endpoints.topupInfo,
    {
      extraHeaders: createUserHeader(user.id),
    },
  );
  const data = resolvePayloadRecord(payload);
  const payMethods = Array.isArray(data.pay_methods)
    ? data.pay_methods.map(normalizePayMethod).filter((item): item is NewApiPayMethod => Boolean(item))
    : [];

  return {
    enabled: Boolean(data.enable_online_topup) && payMethods.length > 0,
    minTopup: asNumber(data.min_topup) ?? 0,
    amountOptions: normalizeAmountOptions(data.amount_options),
    payMethods,
  };
}

function normalizeFormParams(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) {
    return {};
  }

  const params: Record<string, string> = {};
  for (const [key, fieldValue] of Object.entries(record)) {
    if (fieldValue === undefined || fieldValue === null) {
      continue;
    }
    params[key] = String(fieldValue);
  }
  return params;
}

// ---------------------------------------------------------------------------
// requestNewApiEpay — create an epay order (UserAuth)
// ---------------------------------------------------------------------------

export async function requestNewApiEpay(
  accessToken: string,
  amount: number,
  paymentMethod: string,
): Promise<NewApiEpayRequestResult> {
  const config = await getNewApiConfig();
  const user = await getUserSelf(accessToken);
  const payload = await fetchNewApiJson<unknown>(
    accessToken,
    config.endpoints.topupPay,
    {
      method: 'POST',
      extraHeaders: createUserHeader(user.id),
      body: {
        amount,
        payment_method: paymentMethod,
      },
    },
  );
  const record = asRecord(payload) ?? {};
  const message = asString(record.message);
  if (message === 'error') {
    throw new Error(asString(record.data) ?? 'Failed to start payment');
  }

  const paymentUrl = asString(record.url);
  if (!paymentUrl) {
    throw new Error('Invalid payment response: missing url');
  }

  return {
    paymentUrl,
    formParams: normalizeFormParams(record.data),
  };
}
