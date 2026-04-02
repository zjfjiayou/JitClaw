import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserSelf: vi.fn(),
  getNewApiUsageOverview: vi.fn(),
  getNewApiTopupInfo: vi.fn(),
  requestNewApiEpay: vi.fn(),
  ensureNewApiAccount: vi.fn(),
  clearNewApiInferenceKey: vi.fn(),
  refreshNewApiInferenceKey: vi.fn(),
  refreshNewApiInferenceKeySafely: vi.fn(),
  getApiKey: vi.fn(),
  storeApiKey: vi.fn(),
  getNewApiConfig: vi.fn(),
  launchExternalPostForm: vi.fn(),
  parseJsonBody: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock('@electron/services/new-api-service', () => ({
  getUserSelf: (...args: unknown[]) => mocks.getUserSelf(...args),
  getNewApiUsageOverview: (...args: unknown[]) => mocks.getNewApiUsageOverview(...args),
  getNewApiTopupInfo: (...args: unknown[]) => mocks.getNewApiTopupInfo(...args),
  requestNewApiEpay: (...args: unknown[]) => mocks.requestNewApiEpay(...args),
}));

vi.mock('@electron/services/new-api-runtime', () => ({
  ensureNewApiAccount: (...args: unknown[]) => mocks.ensureNewApiAccount(...args),
  clearNewApiInferenceKey: (...args: unknown[]) => mocks.clearNewApiInferenceKey(...args),
  refreshNewApiInferenceKey: (...args: unknown[]) => mocks.refreshNewApiInferenceKey(...args),
  refreshNewApiInferenceKeySafely: (...args: unknown[]) => mocks.refreshNewApiInferenceKeySafely(...args),
}));

vi.mock('@electron/utils/secure-storage', () => ({
  getApiKey: (...args: unknown[]) => mocks.getApiKey(...args),
  storeApiKey: (...args: unknown[]) => mocks.storeApiKey(...args),
}));

vi.mock('@electron/utils/new-api-config', () => ({
  getNewApiConfig: (...args: unknown[]) => mocks.getNewApiConfig(...args),
  NEW_API_ACCOUNT_ID: 'new-api',
  NEW_API_ACCESS_TOKEN_ID: 'new-api-access',
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
  baseUrl: 'https://newapi.example.com/v1',
  apiProtocol: 'openai-completions',
  model: 'gpt-5.4',
  enabled: true,
  isDefault: true,
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

    mocks.ensureNewApiAccount.mockResolvedValue(EXISTING_ACCOUNT);
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
    mocks.parseJsonBody.mockResolvedValue({ accessToken: 'new-access-token-32chars-0000000000' });
    mocks.getUserSelf.mockResolvedValue({
      id: 7,
      username: 'new-user',
      quota: 100,
      usedQuota: 10,
      requestCount: 3,
    });
    mocks.storeApiKey.mockResolvedValue(true);
    mocks.launchExternalPostForm.mockResolvedValue(undefined);
  });

  it('ensures the bundled account on status reads when credentials exist', async () => {
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

    expect(mocks.ensureNewApiAccount).toHaveBeenCalledTimes(1);
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

  it('does not ensure the bundled account on status reads when no credentials exist', async () => {
    mocks.getApiKey.mockResolvedValue(null);

    const { handleNewApiRoutes } = await import('@electron/api/routes/new-api');
    await handleNewApiRoutes(
      { method: 'GET' } as never,
      {} as never,
      new URL('http://localhost/api/new-api/status'),
      createContext(),
    );

    expect(mocks.ensureNewApiAccount).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        accessToken: null,
        configured: false,
        canInfer: false,
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

    expect(mocks.ensureNewApiAccount).toHaveBeenCalledTimes(1);
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
    mocks.refreshNewApiInferenceKey.mockRejectedValue(new Error('token list unavailable'));

    const { handleNewApiRoutes } = await import('@electron/api/routes/new-api');
    const handled = await handleNewApiRoutes(
      { method: 'PUT' } as never,
      {} as never,
      new URL('http://localhost/api/new-api/key'),
      createContext(),
    );

    expect(handled).toBe(true);
    expect(mocks.storeApiKey).toHaveBeenCalledWith('new-api-access', 'new-access-token-32chars-0000000000');
    expect(mocks.clearNewApiInferenceKey).toHaveBeenCalledTimes(1);
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
    mocks.refreshNewApiInferenceKey.mockRejectedValue(new Error('temporary upstream failure'));

    const { handleNewApiRoutes } = await import('@electron/api/routes/new-api');
    await handleNewApiRoutes(
      { method: 'PUT' } as never,
      {} as never,
      new URL('http://localhost/api/new-api/key'),
      createContext(),
    );

    expect(mocks.clearNewApiInferenceKey).not.toHaveBeenCalled();
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

  it('returns noInferenceKey when refresh does not find a usable token', async () => {
    mocks.getApiKey.mockImplementation(async (keyId: string) => {
      if (keyId === 'new-api-access') return 'old-access-token-32chars-0000000000';
      return 'sk-old-inference-key';
    });
    mocks.refreshNewApiInferenceKey.mockResolvedValue(null);

    const { handleNewApiRoutes } = await import('@electron/api/routes/new-api');
    await handleNewApiRoutes(
      { method: 'PUT' } as never,
      {} as never,
      new URL('http://localhost/api/new-api/key'),
      createContext(),
    );

    expect(mocks.clearNewApiInferenceKey).toHaveBeenCalledTimes(1);
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

  it('returns the refreshed token name after saving a valid access token', async () => {
    mocks.getApiKey.mockResolvedValue('old-access-token-32chars-0000000000');
    mocks.refreshNewApiInferenceKey.mockResolvedValue({
      apiKey: 'sk-new-inference-key',
      tokenName: 'default',
    });

    const { handleNewApiRoutes } = await import('@electron/api/routes/new-api');
    await handleNewApiRoutes(
      { method: 'PUT' } as never,
      {} as never,
      new URL('http://localhost/api/new-api/key'),
      createContext(),
    );

    expect(mocks.storeApiKey).toHaveBeenCalledWith('new-api-access', 'new-access-token-32chars-0000000000');
    expect(mocks.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        success: true,
        username: 'new-user',
        tokenName: 'default',
        modelCount: expect.any(Number),
      }),
    );
  });

  it('refreshes the inference key before loading usage overview when none is stored', async () => {
    mocks.getApiKey.mockImplementation(async (keyId: string) => {
      if (keyId === 'new-api-access') return 'saved-access-token';
      if (keyId === 'new-api') return null;
      return null;
    });
    mocks.refreshNewApiInferenceKeySafely.mockResolvedValue({
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

    expect(mocks.refreshNewApiInferenceKeySafely).toHaveBeenCalledTimes(1);
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
    mocks.refreshNewApiInferenceKeySafely.mockResolvedValue({
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
    expect(mocks.refreshNewApiInferenceKeySafely).toHaveBeenCalledTimes(1);
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
