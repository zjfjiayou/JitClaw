import type { GatewayManager } from '../gateway/manager';
import { getProviderService } from './providers/provider-service';
import { providerAccountToConfig } from './providers/provider-store';
import {
  syncUpdatedProviderToRuntime,
  syncDeletedProviderApiKeyToRuntime,
} from './providers/provider-runtime-sync';
import { pickBestApiKey } from './new-api-service';
import type { ProviderAccount } from '../shared/providers/types';
import { getApiKey, storeApiKey, deleteApiKey, getDefaultProvider } from '../utils/secure-storage';
import {
  getNewApiConfig,
  NEW_API_ACCOUNT_ID,
  NEW_API_ACCESS_TOKEN_ID,
  NEW_API_PROVIDER_LABEL,
  resolveNewApiRuntimeBaseUrl,
} from '../utils/new-api-config';
import { resolveNewApiModelId } from '../utils/new-api-models';

export async function ensureNewApiAccount(modelId?: string): Promise<ProviderAccount> {
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
      existing.baseUrl !== runtimeBaseUrl
      || existing.label !== expectedLabel
      || existing.model !== resolvedModelId;

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

export async function clearNewApiInferenceKey(): Promise<void> {
  const account = await ensureNewApiAccount();
  await deleteApiKey(NEW_API_ACCOUNT_ID);
  await syncDeletedProviderApiKeyToRuntime(
    providerAccountToConfig(account),
    NEW_API_ACCOUNT_ID,
  );
}

export async function syncNewApiInferenceKeyToRuntime(
  apiKey: string,
  gatewayManager?: GatewayManager,
): Promise<ProviderAccount> {
  await storeApiKey(NEW_API_ACCOUNT_ID, apiKey);
  const account = await ensureNewApiAccount();
  await syncUpdatedProviderToRuntime(
    providerAccountToConfig(account),
    apiKey,
    gatewayManager,
  );
  return account;
}

export async function refreshNewApiInferenceKey(
  gatewayManager?: GatewayManager,
): Promise<{ apiKey: string; tokenName: string } | null> {
  const accessToken = await getApiKey(NEW_API_ACCESS_TOKEN_ID);
  if (!accessToken) return null;

  const result = await pickBestApiKey(accessToken);
  if (!result) {
    await clearNewApiInferenceKey();
    return null;
  }

  await syncNewApiInferenceKeyToRuntime(result.apiKey, gatewayManager);
  return result;
}

export async function refreshNewApiInferenceKeySafely(
  gatewayManager?: GatewayManager,
): Promise<{ apiKey: string; tokenName: string } | null> {
  try {
    return await refreshNewApiInferenceKey(gatewayManager);
  } catch {
    return null;
  }
}

export async function syncStoredNewApiCredentialsToRuntime(
  gatewayManager?: GatewayManager,
): Promise<void> {
  const accessToken = await getApiKey(NEW_API_ACCESS_TOKEN_ID);
  let inferenceKey = await getApiKey(NEW_API_ACCOUNT_ID);

  if (!accessToken && !inferenceKey) return;

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
  await syncUpdatedProviderToRuntime(providerAccountToConfig(account), inferenceKey, gatewayManager);
}
