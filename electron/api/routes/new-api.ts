import type { IncomingMessage, ServerResponse } from 'http';
import { getProviderService } from '../../services/providers/provider-service';
import { providerAccountToConfig } from '../../services/providers/provider-store';
import {
  syncUpdatedProviderToRuntime,
  syncDeletedProviderApiKeyToRuntime,
} from '../../services/providers/provider-runtime-sync';
import {
  getUserSelf,
  pickBestApiKey,
  getNewApiUsageOverview,
  getNewApiTopupInfo,
  requestNewApiEpay,
} from '../../services/new-api-service';
import type { ProviderAccount } from '../../shared/providers/types';
import { getApiKey, storeApiKey, deleteApiKey, getDefaultProvider } from '../../utils/secure-storage';
import {
  getNewApiConfig,
  NEW_API_ACCOUNT_ID,
  NEW_API_ACCESS_TOKEN_ID,
  NEW_API_PROVIDER_LABEL,
  resolveNewApiRuntimeBaseUrl,
} from '../../utils/new-api-config';
import { launchExternalPostForm } from '../../utils/external-form-launcher';
import {
  listNewApiModelOptions,
  NEW_API_RUNTIME_PROVIDER_KEY,
  resolveNewApiModelId,
} from '../../utils/new-api-models';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

// ---------------------------------------------------------------------------
// Provider account management
// ---------------------------------------------------------------------------

async function ensureNewApiAccount(modelId?: string): Promise<ProviderAccount> {
  const providerService = getProviderService();
  const config = await getNewApiConfig();
  const runtimeBaseUrl = resolveNewApiRuntimeBaseUrl(config.baseUrl);
  const existing = await providerService.getAccount(NEW_API_ACCOUNT_ID);
  const expectedLabel = config.apiLabel || NEW_API_PROVIDER_LABEL;

  if (existing) {
    const resolvedModelId = resolveNewApiModelId(modelId ?? existing.model);
    const persistedDefaultProviderId = await getDefaultProvider();
    const defaultProviderDrift = persistedDefaultProviderId !== NEW_API_ACCOUNT_ID;
    const needsUpdate =
      existing.baseUrl !== runtimeBaseUrl ||
      existing.label !== expectedLabel ||
      existing.model !== resolvedModelId;

    if (needsUpdate) {
      await providerService.updateAccount(NEW_API_ACCOUNT_ID, {
        ...existing,
        label: expectedLabel,
        baseUrl: runtimeBaseUrl,
        model: resolvedModelId,
        updatedAt: new Date().toISOString(),
      });
    }

    if (!existing.isDefault || defaultProviderDrift) {
      await providerService.setDefaultAccount(NEW_API_ACCOUNT_ID);
    }

    return needsUpdate || !existing.isDefault || defaultProviderDrift
      ? (await providerService.getAccount(NEW_API_ACCOUNT_ID)) ?? existing
      : existing;
  }

  const now = new Date().toISOString();
  const newAccount: ProviderAccount = {
    id: NEW_API_ACCOUNT_ID,
    vendorId: 'custom',
    label: expectedLabel,
    authMode: 'api_key',
    baseUrl: runtimeBaseUrl,
    apiProtocol: 'openai-completions',
    model: resolveNewApiModelId(modelId),
    enabled: true,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
  await providerService.createAccount(newAccount);
  await providerService.setDefaultAccount(NEW_API_ACCOUNT_ID);
  return (await providerService.getAccount(NEW_API_ACCOUNT_ID)) ?? newAccount;
}

// ---------------------------------------------------------------------------
// Inference key cleanup — removes from storage AND runtime
// ---------------------------------------------------------------------------

async function clearInferenceKey(): Promise<void> {
  const account = await ensureNewApiAccount();
  await deleteApiKey(NEW_API_ACCOUNT_ID);
  await syncDeletedProviderApiKeyToRuntime(
    providerAccountToConfig(account),
    NEW_API_ACCOUNT_ID,
  );
}

// ---------------------------------------------------------------------------
// Inference key refresh
// ---------------------------------------------------------------------------

async function refreshInferenceKey(
  ctx?: HostApiContext,
): Promise<{ apiKey: string; tokenName: string } | null> {
  const accessToken = await getApiKey(NEW_API_ACCESS_TOKEN_ID);
  if (!accessToken) return null;

  // pickBestApiKey may throw on network errors — let it propagate so callers
  // can distinguish "server unreachable" (thrown) from "no tokens" (null).
  const result = await pickBestApiKey(accessToken);
  if (!result) {
    await clearInferenceKey();
    return null;
  }

  await syncInferenceKeyToRuntime(result.apiKey, ctx);
  return result;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function syncInferenceKeyToRuntime(
  apiKey: string,
  ctx?: HostApiContext,
): Promise<ProviderAccount> {
  await storeApiKey(NEW_API_ACCOUNT_ID, apiKey);
  const account = await ensureNewApiAccount();
  await syncUpdatedProviderToRuntime(
    providerAccountToConfig(account),
    apiKey,
    ctx?.gatewayManager,
  );
  return account;
}

async function getConfiguredAccessToken(res: ServerResponse): Promise<string | null> {
  const accessToken = await getApiKey(NEW_API_ACCESS_TOKEN_ID);
  if (accessToken) {
    return accessToken;
  }

  sendJson(res, 400, { error: 'Access token is not configured' });
  return null;
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

async function refreshInferenceKeySafely(
  ctx?: HostApiContext,
): Promise<{ apiKey: string; tokenName: string } | null> {
  try {
    return await refreshInferenceKey(ctx);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Startup sync
// ---------------------------------------------------------------------------

export async function syncBundledNewApiProviderToRuntime(): Promise<void> {
  const accessToken = await getApiKey(NEW_API_ACCESS_TOKEN_ID);
  let inferenceKey = await getApiKey(NEW_API_ACCOUNT_ID);

  if (!accessToken && !inferenceKey) return;

  // If we have an access token but no inference key, auto-fetch one
  if (accessToken && !inferenceKey) {
    try {
      const result = await pickBestApiKey(accessToken);
      if (result) {
        await storeApiKey(NEW_API_ACCOUNT_ID, result.apiKey);
        inferenceKey = result.apiKey;
      }
    } catch {
      // Can't reach server at startup or key invalid — will retry later
    }
  }

  if (!inferenceKey) return;

  const account = await ensureNewApiAccount();
  await syncUpdatedProviderToRuntime(providerAccountToConfig(account), inferenceKey);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function handleNewApiRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {

  // --- GET /api/new-api/status ---
  if (url.pathname === '/api/new-api/status' && req.method === 'GET') {
    const config = await getNewApiConfig();
    const accessToken = await getApiKey(NEW_API_ACCESS_TOKEN_ID);
    const inferenceKey = await getApiKey(NEW_API_ACCOUNT_ID);
    if (accessToken || inferenceKey) {
      await ensureNewApiAccount();
    }

    sendJson(res, 200, {
      accountId: NEW_API_ACCOUNT_ID,
      apiLabel: config.apiLabel,
      baseUrl: config.baseUrl,
      accessToken,
      hasAccessToken: Boolean(accessToken),
      hasInferenceKey: Boolean(inferenceKey),
      configured: Boolean(accessToken),
      canInfer: Boolean(inferenceKey),
    });
    return true;
  }

  // --- PUT /api/new-api/key (save access token) ---
  if (url.pathname === '/api/new-api/key' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ accessToken?: string }>(req);
      const accessToken = body.accessToken?.trim();
      if (!accessToken) {
        sendJson(res, 400, { success: false, error: 'Access token is required' });
        return true;
      }

      // Validate access token by fetching user info — if this fails, it's a real error
      const user = await getUserSelf(accessToken);
      const previousAccessToken = await getApiKey(NEW_API_ACCESS_TOKEN_ID);
      await storeApiKey(NEW_API_ACCESS_TOKEN_ID, accessToken);

      // Auto-fetch inference key — failures here are partial success (access token is valid)
      let storedNewInferenceKey = false;
      try {
        const picked = await pickBestApiKey(accessToken);
        if (!picked) {
          await clearInferenceKey();
          sendJson(res, 200, {
            success: true,
            username: user.username,
            noInferenceKey: true,
          });
          return true;
        }

        storedNewInferenceKey = true;
        await syncInferenceKeyToRuntime(picked.apiKey, ctx);

        sendJson(res, 200, {
          success: true,
          username: user.username,
          tokenName: picked.tokenName,
          modelCount: listNewApiModelOptions().length,
        });
      } catch (error) {
        const changedAccessToken = Boolean(previousAccessToken && previousAccessToken !== accessToken);
        if (changedAccessToken || storedNewInferenceKey) {
          await clearInferenceKey();
        }

        sendJson(res, 200, {
          success: true,
          username: user.username,
          inferenceError: toErrorMessage(error),
        });
      }
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // --- GET /api/new-api/models ---
  if (url.pathname === '/api/new-api/models' && req.method === 'GET') {
    const providerKey = NEW_API_RUNTIME_PROVIDER_KEY;
    try {
      const account = await ensureNewApiAccount();
      sendJson(res, 200, {
        providerKey,
        selectedModelId: resolveNewApiModelId(account.model),
        models: listNewApiModelOptions(),
      });
    } catch (error) {
      sendJson(res, 500, { error: String(error), providerKey, models: listNewApiModelOptions() });
    }
    return true;
  }

  // --- GET /api/new-api/usage/overview ---
  if (url.pathname === '/api/new-api/usage/overview' && req.method === 'GET') {
    try {
      const accessToken = await getApiKey(NEW_API_ACCESS_TOKEN_ID);
      let inferenceKey = await getApiKey(NEW_API_ACCOUNT_ID);
      if (!accessToken && !inferenceKey) {
        sendJson(res, 200, { account: {}, billing: null, logs: [] });
        return true;
      }

      if (!inferenceKey && accessToken) {
        inferenceKey = (await refreshInferenceKeySafely(ctx))?.apiKey ?? null;
      }

      let overview = await getNewApiUsageOverview(accessToken, inferenceKey);
      if (overview.billing === null && accessToken) {
        const refreshedInferenceKey = (await refreshInferenceKeySafely(ctx))?.apiKey ?? null;
        if (refreshedInferenceKey) {
          overview = await getNewApiUsageOverview(accessToken, refreshedInferenceKey);
        }
      }

      sendJson(res, 200, overview);
    } catch (error) {
      sendJson(res, 500, { error: String(error) });
    }
    return true;
  }

  // --- GET /api/new-api/topup/info ---
  if (url.pathname === '/api/new-api/topup/info' && req.method === 'GET') {
    try {
      const accessToken = await getConfiguredAccessToken(res);
      if (!accessToken) {
        return true;
      }

      const info = await getNewApiTopupInfo(accessToken);
      sendJson(res, 200, info);
    } catch (error) {
      sendJson(res, 500, { error: toErrorMessage(error) });
    }
    return true;
  }

  // --- POST /api/new-api/topup/pay ---
  if (url.pathname === '/api/new-api/topup/pay' && req.method === 'POST') {
    try {
      const accessToken = await getConfiguredAccessToken(res);
      if (!accessToken) {
        return true;
      }

      const body = await parseJsonBody<{ amount?: unknown; paymentMethod?: unknown }>(req);
      const amount = parsePositiveInteger(body.amount);
      const paymentMethod = typeof body.paymentMethod === 'string' ? body.paymentMethod.trim() : '';
      if (!amount) {
        sendJson(res, 400, { error: 'Amount must be a positive integer' });
        return true;
      }
      if (!paymentMethod) {
        sendJson(res, 400, { error: 'Payment method is required' });
        return true;
      }

      const info = await getNewApiTopupInfo(accessToken);
      if (!info.enabled) {
        sendJson(res, 400, { error: 'Online top-up is not enabled' });
        return true;
      }

      const selectedMethod = info.payMethods.find((method) => method.type === paymentMethod);
      if (!selectedMethod) {
        sendJson(res, 400, { error: 'Payment method is not supported' });
        return true;
      }

      const minTopup = selectedMethod.minTopup ?? info.minTopup;
      if (minTopup > 0 && amount < minTopup) {
        sendJson(res, 400, { error: `Amount must be at least ${minTopup}` });
        return true;
      }

      const payment = await requestNewApiEpay(accessToken, amount, paymentMethod);
      await launchExternalPostForm(payment.paymentUrl, payment.formParams);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { error: toErrorMessage(error) });
    }
    return true;
  }

  return false;
}
