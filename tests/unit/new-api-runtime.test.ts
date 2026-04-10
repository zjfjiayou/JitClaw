import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getProviderService: vi.fn(),
  providerService: {
    getAccount: vi.fn(),
    updateAccount: vi.fn(),
    createAccount: vi.fn(),
    setDefaultAccount: vi.fn(),
  },
  providerAccountToConfig: vi.fn(),
  syncUpdatedProviderToRuntime: vi.fn(),
  syncDeletedProviderApiKeyToRuntime: vi.fn(),
  pickBestApiKey: vi.fn(),
  getApiKey: vi.fn(),
  storeApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  getDefaultProvider: vi.fn(),
  getNewApiConfig: vi.fn(),
  resolveNewApiRuntimeBaseUrl: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-service', () => ({
  getProviderService: (...args: unknown[]) => mocks.getProviderService(...args),
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  providerAccountToConfig: (...args: unknown[]) => mocks.providerAccountToConfig(...args),
}));

vi.mock('@electron/services/providers/provider-runtime-sync', () => ({
  syncUpdatedProviderToRuntime: (...args: unknown[]) => mocks.syncUpdatedProviderToRuntime(...args),
  syncDeletedProviderApiKeyToRuntime: (...args: unknown[]) => mocks.syncDeletedProviderApiKeyToRuntime(...args),
}));

vi.mock('@electron/services/new-api-service', () => ({
  pickBestApiKey: (...args: unknown[]) => mocks.pickBestApiKey(...args),
}));

vi.mock('@electron/utils/secure-storage', () => ({
  getApiKey: (...args: unknown[]) => mocks.getApiKey(...args),
  storeApiKey: (...args: unknown[]) => mocks.storeApiKey(...args),
  deleteApiKey: (...args: unknown[]) => mocks.deleteApiKey(...args),
  getDefaultProvider: (...args: unknown[]) => mocks.getDefaultProvider(...args),
}));

vi.mock('@electron/utils/new-api-config', () => ({
  getNewApiConfig: (...args: unknown[]) => mocks.getNewApiConfig(...args),
  NEW_API_ACCOUNT_ID: 'new-api',
  NEW_API_ACCESS_TOKEN_ID: 'new-api-access',
  NEW_API_PROVIDER_LABEL: 'New API',
  resolveNewApiRuntimeBaseUrl: (...args: unknown[]) => mocks.resolveNewApiRuntimeBaseUrl(...args),
}));

const EXISTING_ACCOUNT = {
  id: 'new-api',
  vendorId: 'custom',
  label: 'New API',
  authMode: 'api_key',
  baseUrl: 'https://newapi.example.com',
  apiProtocol: 'openai-completions',
  model: 'gpt-5.4',
  enabled: true,
  isDefault: true,
  createdAt: '2026-03-31T00:00:00.000Z',
  updatedAt: '2026-03-31T00:00:00.000Z',
};

const PROVIDER_CONFIG = {
  id: 'new-api',
  name: 'New API',
  type: 'custom',
  baseUrl: 'https://newapi.example.com/v1',
  apiProtocol: 'openai-completions',
  model: 'gpt-5.4',
};

describe('new api runtime', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.getProviderService.mockReturnValue(mocks.providerService);
    mocks.providerService.getAccount.mockResolvedValue(EXISTING_ACCOUNT);
    mocks.providerService.updateAccount.mockResolvedValue(undefined);
    mocks.providerService.createAccount.mockResolvedValue(undefined);
    mocks.providerService.setDefaultAccount.mockResolvedValue(undefined);
    mocks.providerAccountToConfig.mockReturnValue(PROVIDER_CONFIG);
    mocks.syncUpdatedProviderToRuntime.mockResolvedValue(undefined);
    mocks.syncDeletedProviderApiKeyToRuntime.mockResolvedValue(undefined);
    mocks.pickBestApiKey.mockResolvedValue({ apiKey: 'sk-fresh', tokenName: 'default' });
    mocks.getApiKey.mockResolvedValue(null);
    mocks.storeApiKey.mockResolvedValue(true);
    mocks.deleteApiKey.mockResolvedValue(true);
    mocks.getDefaultProvider.mockResolvedValue('new-api');
    mocks.getNewApiConfig.mockResolvedValue({
      apiLabel: 'New API',
      baseUrl: 'https://newapi.example.com',
    });
    mocks.resolveNewApiRuntimeBaseUrl.mockImplementation((baseUrl: string) => `${baseUrl}/v1`);
  });

  it('repairs default-provider drift even when the account is already marked default in the provider store', async () => {
    mocks.getDefaultProvider.mockResolvedValue('legacy-provider');
    mocks.providerService.getAccount.mockResolvedValueOnce({
      ...EXISTING_ACCOUNT,
      baseUrl: 'https://newapi.example.com',
    }).mockResolvedValueOnce({
      ...EXISTING_ACCOUNT,
      baseUrl: 'https://newapi.example.com/v1',
    });

    const { ensureNewApiAccount } = await import('@electron/services/new-api-runtime');
    const result = await ensureNewApiAccount();

    expect(mocks.providerService.updateAccount).toHaveBeenCalledWith(
      'new-api',
      expect.objectContaining({
        baseUrl: 'https://newapi.example.com/v1',
      }),
    );
    expect(mocks.providerService.setDefaultAccount).toHaveBeenCalledWith('new-api');
    expect(result).toEqual(expect.objectContaining({ baseUrl: 'https://newapi.example.com/v1' }));
  });

  it('normalizes a legacy bundled New API model to the bundled default model', async () => {
    mocks.providerService.getAccount.mockResolvedValueOnce({
      ...EXISTING_ACCOUNT,
      model: 'gpt-4.1-mini',
      baseUrl: 'https://newapi.example.com/v1',
    }).mockResolvedValueOnce({
      ...EXISTING_ACCOUNT,
      model: 'gpt-5.4',
      baseUrl: 'https://newapi.example.com/v1',
    });

    const { ensureNewApiAccount } = await import('@electron/services/new-api-runtime');
    const result = await ensureNewApiAccount();

    expect(mocks.providerService.updateAccount).toHaveBeenCalledWith(
      'new-api',
      expect.objectContaining({
        model: 'gpt-5.4',
      }),
    );
    expect(result).toEqual(expect.objectContaining({ model: 'gpt-5.4' }));
  });

  it('creates the bundled account when it does not exist', async () => {
    const createdAt = '2026-04-02T00:00:00.000Z';
    vi.useFakeTimers();
    vi.setSystemTime(new Date(createdAt));
    mocks.providerService.getAccount.mockResolvedValueOnce(null).mockResolvedValueOnce({
      ...EXISTING_ACCOUNT,
      baseUrl: 'https://newapi.example.com/v1',
      createdAt,
      updatedAt: createdAt,
    });

    try {
      const { ensureNewApiAccount } = await import('@electron/services/new-api-runtime');
      const result = await ensureNewApiAccount();

      expect(mocks.providerService.createAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'new-api',
          label: 'New API',
          baseUrl: 'https://newapi.example.com/v1',
          model: 'gpt-5.4',
          isDefault: true,
          createdAt,
          updatedAt: createdAt,
        }),
      );
      expect(mocks.providerService.setDefaultAccount).toHaveBeenCalledWith('new-api');
      expect(result).toEqual(expect.objectContaining({ baseUrl: 'https://newapi.example.com/v1' }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the stored inference key and syncs deletion to runtime', async () => {
    mocks.providerService.getAccount.mockResolvedValue({
      ...EXISTING_ACCOUNT,
      baseUrl: 'https://newapi.example.com/v1',
    });

    const { clearNewApiInferenceKey } = await import('@electron/services/new-api-runtime');
    await clearNewApiInferenceKey();

    expect(mocks.deleteApiKey).toHaveBeenCalledWith('new-api');
    expect(mocks.providerAccountToConfig).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-api' }));
    expect(mocks.syncDeletedProviderApiKeyToRuntime).toHaveBeenCalledWith(PROVIDER_CONFIG, 'new-api');
  });

  it('stores and syncs a refreshed inference key to runtime', async () => {
    const gatewayManager = { debouncedReload: vi.fn(), getStatus: vi.fn(() => ({ state: 'running' })) } as never;
    mocks.providerService.getAccount.mockResolvedValue({
      ...EXISTING_ACCOUNT,
      baseUrl: 'https://newapi.example.com/v1',
    });

    const { syncNewApiInferenceKeyToRuntime } = await import('@electron/services/new-api-runtime');
    const result = await syncNewApiInferenceKeyToRuntime('sk-live', gatewayManager);

    expect(mocks.storeApiKey).toHaveBeenCalledWith('new-api', 'sk-live');
    expect(mocks.syncUpdatedProviderToRuntime).toHaveBeenCalledWith(PROVIDER_CONFIG, 'sk-live', gatewayManager);
    expect(result).toEqual(expect.objectContaining({ id: 'new-api' }));
  });

  it('refreshes the inference key from the best usable token', async () => {
    const gatewayManager = { debouncedReload: vi.fn(), getStatus: vi.fn(() => ({ state: 'running' })) } as never;
    mocks.getApiKey.mockImplementation(async (keyId: string) => {
      if (keyId === 'new-api-access') return 'saved-access-token';
      return null;
    });
    mocks.providerService.getAccount.mockResolvedValue({
      ...EXISTING_ACCOUNT,
      baseUrl: 'https://newapi.example.com/v1',
    });

    const { refreshNewApiInferenceKey } = await import('@electron/services/new-api-runtime');
    const result = await refreshNewApiInferenceKey(gatewayManager);

    expect(mocks.pickBestApiKey).toHaveBeenCalledWith('saved-access-token');
    expect(mocks.storeApiKey).toHaveBeenCalledWith('new-api', 'sk-fresh');
    expect(mocks.syncUpdatedProviderToRuntime).toHaveBeenCalledWith(PROVIDER_CONFIG, 'sk-fresh', gatewayManager);
    expect(result).toEqual({ apiKey: 'sk-fresh', tokenName: 'default' });
  });

  it('clears the current inference key when no usable token exists', async () => {
    mocks.getApiKey.mockImplementation(async (keyId: string) => {
      if (keyId === 'new-api-access') return 'saved-access-token';
      return null;
    });
    mocks.pickBestApiKey.mockResolvedValue(null);
    mocks.providerService.getAccount.mockResolvedValue({
      ...EXISTING_ACCOUNT,
      baseUrl: 'https://newapi.example.com/v1',
    });

    const { refreshNewApiInferenceKey } = await import('@electron/services/new-api-runtime');
    const result = await refreshNewApiInferenceKey();

    expect(mocks.deleteApiKey).toHaveBeenCalledWith('new-api');
    expect(mocks.syncDeletedProviderApiKeyToRuntime).toHaveBeenCalledWith(PROVIDER_CONFIG, 'new-api');
    expect(result).toBeNull();
  });

  it('returns null safely when refresh throws', async () => {
    mocks.getApiKey.mockImplementation(async (keyId: string) => {
      if (keyId === 'new-api-access') return 'saved-access-token';
      return null;
    });
    mocks.pickBestApiKey.mockRejectedValue(new Error('temporary upstream failure'));

    const { refreshNewApiInferenceKeySafely } = await import('@electron/services/new-api-runtime');
    const result = await refreshNewApiInferenceKeySafely();

    expect(result).toBeNull();
  });

  it('syncs stored credentials to runtime on startup without forcing a pre-start gateway refresh', async () => {
    const gatewayManager = { debouncedReload: vi.fn(), getStatus: vi.fn(() => ({ state: 'stopped' })) } as never;
    mocks.getApiKey.mockImplementation(async (keyId: string) => {
      if (keyId === 'new-api-access') return 'saved-access-token';
      if (keyId === 'new-api') return null;
      return null;
    });
    mocks.providerService.getAccount.mockResolvedValue({
      ...EXISTING_ACCOUNT,
      baseUrl: 'https://newapi.example.com/v1',
    });

    const { syncStoredNewApiCredentialsToRuntime } = await import('@electron/services/new-api-runtime');
    await syncStoredNewApiCredentialsToRuntime(gatewayManager, { onlyIfRunning: true });

    expect(mocks.pickBestApiKey).toHaveBeenCalledWith('saved-access-token');
    expect(mocks.storeApiKey).toHaveBeenCalledWith('new-api', 'sk-fresh');
    expect(mocks.syncUpdatedProviderToRuntime).toHaveBeenCalledWith(
      PROVIDER_CONFIG,
      'sk-fresh',
      gatewayManager,
      { onlyIfRunning: true },
    );
  });

  it('skips startup sync when there are no stored credentials', async () => {
    const { syncStoredNewApiCredentialsToRuntime } = await import('@electron/services/new-api-runtime');
    await syncStoredNewApiCredentialsToRuntime();

    expect(mocks.pickBestApiKey).not.toHaveBeenCalled();
    expect(mocks.syncUpdatedProviderToRuntime).not.toHaveBeenCalled();
  });

  it('skips runtime sync when startup refresh cannot obtain an inference key', async () => {
    mocks.getApiKey.mockImplementation(async (keyId: string) => {
      if (keyId === 'new-api-access') return 'saved-access-token';
      if (keyId === 'new-api') return null;
      return null;
    });
    mocks.pickBestApiKey.mockRejectedValue(new Error('network down'));

    const { syncStoredNewApiCredentialsToRuntime } = await import('@electron/services/new-api-runtime');
    await syncStoredNewApiCredentialsToRuntime();

    expect(mocks.storeApiKey).not.toHaveBeenCalledWith('new-api', expect.anything());
    expect(mocks.syncUpdatedProviderToRuntime).not.toHaveBeenCalled();
  });
});
