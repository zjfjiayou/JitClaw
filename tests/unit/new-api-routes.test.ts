import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  providerService: {
    getAccount: vi.fn(),
    updateAccount: vi.fn(),
    setDefaultAccount: vi.fn(),
    createAccount: vi.fn(),
  },
  getProviderService: vi.fn(),
  providerAccountToConfig: vi.fn(),
  syncUpdatedProviderToRuntime: vi.fn(),
  syncDeletedProviderApiKeyToRuntime: vi.fn(),
  getUserSelf: vi.fn(),
  pickBestApiKey: vi.fn(),
  getNewApiUsageOverview: vi.fn(),
  getNewApiTopupInfo: vi.fn(),
  requestNewApiEpay: vi.fn(),
  getApiKey: vi.fn(),
  getDefaultProvider: vi.fn(),
  storeApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  getNewApiConfig: vi.fn(),
  resolveNewApiRuntimeBaseUrl: vi.fn(),
  launchExternalPostForm: vi.fn(),
  parseJsonBody: vi.fn(),
  sendJson: vi.fn(),
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
  getUserSelf: (...args: unknown[]) => mocks.getUserSelf(...args),
  pickBestApiKey: (...args: unknown[]) => mocks.pickBestApiKey(...args),
  getNewApiUsageOverview: (...args: unknown[]) => mocks.getNewApiUsageOverview(...args),
  getNewApiTopupInfo: (...args: unknown[]) => mocks.getNewApiTopupInfo(...args),
  requestNewApiEpay: (...args: unknown[]) => mocks.requestNewApiEpay(...args),
}));

vi.mock('@electron/utils/secure-storage', () => ({
  getApiKey: (...args: unknown[]) => mocks.getApiKey(...args),
  getDefaultProvider: (...args: unknown[]) => mocks.getDefaultProvider(...args),
  storeApiKey: (...args: unknown[]) => mocks.storeApiKey(...args),
  deleteApiKey: (...args: unknown[]) => mocks.deleteApiKey(...args),
}));

vi.mock('@electron/utils/new-api-config', () => ({
  getNewApiConfig: (...args: unknown[]) => mocks.getNewApiConfig(...args),
  resolveNewApiRuntimeBaseUrl: (...args: unknown[]) => mocks.resolveNewApiRuntimeBaseUrl(...args),
  NEW_API_ACCOUNT_ID: 'new-api',
  NEW_API_ACCESS_TOKEN_ID: 'new-api-access',
  NEW_API_PROVIDER_LABEL: 'New API',
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => mocks.parseJsonBody(...args),
  sendJson: (...args: unknown[]) => mocks.sendJson(...args),
}));

vi.mock('@electron/utils/external-form-launcher', () => ({
  launchExternalPostForm: (...args: unknown[]) => mocks.launchExternalPostForm(...args),
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
  baseUrl: 'https://newapi.example.com',
  apiProtocol: 'openai-completions',
  model: 'gpt-5.4',
  enabled: true,
  createdAt: '2026-03-31T00:00:00.000Z',
  updatedAt: '2026-03-31T00:00:00.000Z',
};

function createContext() {
  return {
    gatewayManager: {
      debouncedReload: vi.fn(),
      getStatus: vi.fn(() => ({ state: 'running' })),
    },
  } as never;
}

describe('new api routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();

    mocks.getProviderService.mockReturnValue(mocks.providerService);
    mocks.providerService.getAccount.mockResolvedValue(EXISTING_ACCOUNT);
    mocks.providerAccountToConfig.mockReturnValue(PROVIDER_CONFIG);
    mocks.getNewApiConfig.mockResolvedValue({
      apiLabel: 'New API',
      baseUrl: 'https://newapi.example.com',
      endpoints: {
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
      },
    });
    mocks.resolveNewApiRuntimeBaseUrl.mockImplementation((baseUrl: string) => `${baseUrl}/v1`);
    mocks.parseJsonBody.mockResolvedValue({ accessToken: 'new-access-token-32chars-0000000000' });
    mocks.getDefaultProvider.mockResolvedValue('new-api');
    mocks.getUserSelf.mockResolvedValue({
      id: 7,
      username: 'new-user',
      quota: 100,
      usedQuota: 10,
      requestCount: 3,
    });
    mocks.storeApiKey.mockResolvedValue(true);
    mocks.deleteApiKey.mockResolvedValue(true);
    mocks.syncDeletedProviderApiKeyToRuntime.mockResolvedValue(undefined);
    mocks.syncUpdatedProviderToRuntime.mockResolvedValue(undefined);
    mocks.launchExternalPostForm.mockResolvedValue(undefined);
  });

  it('repairs default provider drift even when the bundled account is already marked default in provider store', async () => {
    mocks.getApiKey.mockImplementation(async (keyId: string) => {
      if (keyId === 'new-api-access') return 'saved-access-token';
      if (keyId === 'new-api') return 'sk-current-inference-key';
      return null;
    });
    mocks.getDefaultProvider.mockResolvedValue('legacy-provider');

    const { handleNewApiRoutes } = await import('@electron/api/routes/new-api');
    await handleNewApiRoutes(
      { method: 'GET' } as never,
      {} as never,
      new URL('http://localhost/api/new-api/status'),
      createContext(),
    );

    expect(mocks.providerService.setDefaultAccount).toHaveBeenCalledWith('new-api');
    expect(mocks.providerService.updateAccount).toHaveBeenCalledWith(
      'new-api',
      expect.objectContaining({
        baseUrl: 'https://newapi.example.com/v1',
      }),
    );
    expect(mocks.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        accessToken: 'saved-access-token',
        configured: true,
        canInfer: true,
      }),
    );
  });

  it('normalizes a legacy bundled New API model to the bundled default model', async () => {
    mocks.providerService.getAccount.mockResolvedValue({
      ...EXISTING_ACCOUNT,
      model: 'gpt-4.1-mini',
    });
    mocks.getApiKey.mockImplementation(async (keyId: string) => {
      if (keyId === 'new-api-access') return 'saved-access-token';
      if (keyId === 'new-api') return 'sk-current-inference-key';
      return null;
    });

    const { handleNewApiRoutes } = await import('@electron/api/routes/new-api');
    await handleNewApiRoutes(
      { method: 'GET' } as never,
      {} as never,
      new URL('http://localhost/api/new-api/status'),
      createContext(),
    );

    expect(mocks.providerService.updateAccount).toHaveBeenCalledWith(
      'new-api',
      expect.objectContaining({
        model: 'gpt-5.4',
      }),
    );
  });

  it('returns the bundled model catalog from the New API models route', async () => {
    const { handleNewApiRoutes } = await import('@electron/api/routes/new-api');
    await handleNewApiRoutes(
      { method: 'GET' } as never,
      {} as never,
      new URL('http://localhost/api/new-api/models'),
      createContext(),
    );

    expect(mocks.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        providerKey: 'custom-newapi',
        selectedModelId: 'gpt-5.4',
        models: [
          expect.objectContaining({ id: 'gpt-5.4', name: 'gpt-5.4' }),
          expect.objectContaining({ id: 'gpt-5.3-codex', name: 'gpt-5.3-codex' }),
        ],
      }),
    );
  });

  it('clears the stale inference key when switching access tokens and refresh fails', async () => {
    mocks.getApiKey.mockImplementation(async (keyId: string) => {
      if (keyId === 'new-api-access') return 'old-access-token-32chars-0000000000';
      return 'sk-old-inference-key';
    });
    mocks.pickBestApiKey.mockRejectedValue(new Error('token list unavailable'));

    const { handleNewApiRoutes } = await import('@electron/api/routes/new-api');
    const handled = await handleNewApiRoutes(
      { method: 'PUT' } as never,
      {} as never,
      new URL('http://localhost/api/new-api/key'),
      createContext(),
    );

    expect(handled).toBe(true);
    expect(mocks.storeApiKey).toHaveBeenCalledWith('new-api-access', 'new-access-token-32chars-0000000000');
    expect(mocks.deleteApiKey).toHaveBeenCalledWith('new-api');
    expect(mocks.syncDeletedProviderApiKeyToRuntime).toHaveBeenCalledWith(
      PROVIDER_CONFIG,
      'new-api',
    );
    expect(mocks.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        success: true,
        username: 'new-user',
        inferenceError: 'token list unavailable',
      }),
    );
    expect(mocks.sendJson).not.toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({ noInferenceKey: true }),
    );
  });

  it('keeps the current inference key when re-saving the same access token and refresh fails transiently', async () => {
    mocks.getApiKey.mockImplementation(async (keyId: string) => {
      if (keyId === 'new-api-access') return 'new-access-token-32chars-0000000000';
      return 'sk-current-inference-key';
    });
    mocks.pickBestApiKey.mockRejectedValue(new Error('temporary upstream failure'));

    const { handleNewApiRoutes } = await import('@electron/api/routes/new-api');
    await handleNewApiRoutes(
      { method: 'PUT' } as never,
      {} as never,
      new URL('http://localhost/api/new-api/key'),
      createContext(),
    );

    expect(mocks.deleteApiKey).not.toHaveBeenCalled();
    expect(mocks.syncDeletedProviderApiKeyToRuntime).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        success: true,
        username: 'new-user',
        inferenceError: 'temporary upstream failure',
      }),
    );
  });

  it('clears the previous inference key and returns noInferenceKey when no usable token exists', async () => {
    mocks.getApiKey.mockImplementation(async (keyId: string) => {
      if (keyId === 'new-api-access') return 'old-access-token-32chars-0000000000';
      return 'sk-old-inference-key';
    });
    mocks.pickBestApiKey.mockResolvedValue(null);

    const { handleNewApiRoutes } = await import('@electron/api/routes/new-api');
    await handleNewApiRoutes(
      { method: 'PUT' } as never,
      {} as never,
      new URL('http://localhost/api/new-api/key'),
      createContext(),
    );

    expect(mocks.deleteApiKey).toHaveBeenCalledWith('new-api');
    expect(mocks.syncDeletedProviderApiKeyToRuntime).toHaveBeenCalledWith(
      PROVIDER_CONFIG,
      'new-api',
    );
    expect(mocks.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        success: true,
        username: 'new-user',
        noInferenceKey: true,
      }),
    );
  });

  it('clears a newly stored inference key when runtime sync fails', async () => {
    mocks.getApiKey.mockImplementation(async (keyId: string) => {
      if (keyId === 'new-api-access') return 'old-access-token-32chars-0000000000';
      return 'sk-old-inference-key';
    });
    mocks.pickBestApiKey.mockResolvedValue({
      apiKey: 'sk-new-inference-key',
      tokenName: 'default',
    });
    mocks.syncUpdatedProviderToRuntime.mockRejectedValue(new Error('gateway reload failed'));

    const { handleNewApiRoutes } = await import('@electron/api/routes/new-api');
    await handleNewApiRoutes(
      { method: 'PUT' } as never,
      {} as never,
      new URL('http://localhost/api/new-api/key'),
      createContext(),
    );

    expect(mocks.storeApiKey).toHaveBeenCalledWith('new-api', 'sk-new-inference-key');
    expect(mocks.deleteApiKey).toHaveBeenCalledWith('new-api');
    expect(mocks.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        success: true,
        username: 'new-user',
        inferenceError: 'gateway reload failed',
      }),
    );
  });

  it('refreshes the inference key before loading usage overview when none is stored', async () => {
    mocks.getApiKey.mockImplementation(async (keyId: string) => {
      if (keyId === 'new-api-access') return 'saved-access-token';
      if (keyId === 'new-api') return null;
      return null;
    });
    mocks.pickBestApiKey.mockResolvedValue({
      apiKey: 'sk-fresh-inference-key',
      tokenName: 'default',
    });
    mocks.getNewApiUsageOverview.mockResolvedValue({
      account: { username: 'new-user' },
      billing: { hardLimitUsd: 50, totalUsageUsd: 12.34 },
      logs: [],
    });

    const { handleNewApiRoutes } = await import('@electron/api/routes/new-api');
    await handleNewApiRoutes(
      { method: 'GET' } as never,
      {} as never,
      new URL('http://localhost/api/new-api/usage/overview'),
      createContext(),
    );

    expect(mocks.pickBestApiKey).toHaveBeenCalledWith('saved-access-token');
    expect(mocks.getNewApiUsageOverview).toHaveBeenCalledWith('saved-access-token', 'sk-fresh-inference-key');
    expect(mocks.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        billing: expect.objectContaining({
          hardLimitUsd: 50,
          totalUsageUsd: 12.34,
        }),
      }),
    );
  });

  it('retries usage overview with a refreshed inference key when billing is unavailable', async () => {
    mocks.getApiKey.mockImplementation(async (keyId: string) => {
      if (keyId === 'new-api-access') return 'saved-access-token';
      if (keyId === 'new-api') return 'sk-stale-inference-key';
      return null;
    });
    mocks.getNewApiUsageOverview
      .mockResolvedValueOnce({
        account: { username: 'new-user' },
        billing: null,
        logs: [],
      })
      .mockResolvedValueOnce({
        account: { username: 'new-user' },
        billing: { hardLimitUsd: 50, totalUsageUsd: 10 },
        logs: [],
      });
    mocks.pickBestApiKey.mockResolvedValue({
      apiKey: 'sk-refreshed-inference-key',
      tokenName: 'default',
    });

    const { handleNewApiRoutes } = await import('@electron/api/routes/new-api');
    await handleNewApiRoutes(
      { method: 'GET' } as never,
      {} as never,
      new URL('http://localhost/api/new-api/usage/overview'),
      createContext(),
    );

    expect(mocks.getNewApiUsageOverview).toHaveBeenNthCalledWith(1, 'saved-access-token', 'sk-stale-inference-key');
    expect(mocks.pickBestApiKey).toHaveBeenCalledWith('saved-access-token');
    expect(mocks.getNewApiUsageOverview).toHaveBeenNthCalledWith(2, 'saved-access-token', 'sk-refreshed-inference-key');
    expect(mocks.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        billing: expect.objectContaining({
          hardLimitUsd: 50,
          totalUsageUsd: 10,
        }),
      }),
    );
  });

  it('returns normalized topup info for the usage page', async () => {
    mocks.getApiKey.mockImplementation(async (keyId: string) => {
      if (keyId === 'new-api-access') return 'saved-access-token';
      return null;
    });
    mocks.getNewApiTopupInfo.mockResolvedValue({
      enabled: true,
      minTopup: 10,
      amountOptions: [10, 20],
      payMethods: [
        { name: 'Alipay', type: 'alipay', minTopup: 10 },
      ],
    });

    const { handleNewApiRoutes } = await import('@electron/api/routes/new-api');
    await handleNewApiRoutes(
      { method: 'GET' } as never,
      {} as never,
      new URL('http://localhost/api/new-api/topup/info'),
      createContext(),
    );

    expect(mocks.getNewApiTopupInfo).toHaveBeenCalledWith('saved-access-token');
    expect(mocks.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        enabled: true,
        minTopup: 10,
        payMethods: [
          expect.objectContaining({ type: 'alipay' }),
        ],
      }),
    );
  });

  it('launches an epay checkout after validating amount and payment method', async () => {
    mocks.getApiKey.mockImplementation(async (keyId: string) => {
      if (keyId === 'new-api-access') return 'saved-access-token';
      return null;
    });
    mocks.parseJsonBody.mockResolvedValue({
      amount: 20,
      paymentMethod: 'alipay',
    });
    mocks.getNewApiTopupInfo.mockResolvedValue({
      enabled: true,
      minTopup: 10,
      amountOptions: [10, 20],
      payMethods: [
        { name: 'Alipay', type: 'alipay', minTopup: 10 },
      ],
    });
    mocks.requestNewApiEpay.mockResolvedValue({
      paymentUrl: 'https://pay.example.com/submit',
      formParams: { pid: '1', out_trade_no: 'trade-1' },
    });

    const { handleNewApiRoutes } = await import('@electron/api/routes/new-api');
    await handleNewApiRoutes(
      { method: 'POST' } as never,
      {} as never,
      new URL('http://localhost/api/new-api/topup/pay'),
      createContext(),
    );

    expect(mocks.requestNewApiEpay).toHaveBeenCalledWith('saved-access-token', 20, 'alipay');
    expect(mocks.launchExternalPostForm).toHaveBeenCalledWith(
      'https://pay.example.com/submit',
      { pid: '1', out_trade_no: 'trade-1' },
    );
    expect(mocks.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      200,
      { success: true },
    );
  });

  it('rejects unsupported epay payment methods before contacting the payment gateway', async () => {
    mocks.getApiKey.mockImplementation(async (keyId: string) => {
      if (keyId === 'new-api-access') return 'saved-access-token';
      return null;
    });
    mocks.parseJsonBody.mockResolvedValue({
      amount: 20,
      paymentMethod: 'wechatpay',
    });
    mocks.getNewApiTopupInfo.mockResolvedValue({
      enabled: true,
      minTopup: 10,
      amountOptions: [10, 20],
      payMethods: [
        { name: 'Alipay', type: 'alipay', minTopup: 10 },
      ],
    });

    const { handleNewApiRoutes } = await import('@electron/api/routes/new-api');
    await handleNewApiRoutes(
      { method: 'POST' } as never,
      {} as never,
      new URL('http://localhost/api/new-api/topup/pay'),
      createContext(),
    );

    expect(mocks.requestNewApiEpay).not.toHaveBeenCalled();
    expect(mocks.launchExternalPostForm).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      400,
      expect.objectContaining({
        error: 'Payment method is not supported',
      }),
    );
  });
});
