import { beforeEach, describe, expect, it, vi } from 'vitest';

const proxyAwareFetch = vi.fn();
const getNewApiConfigMock = vi.fn();

vi.mock('@electron/utils/proxy-fetch', () => ({
  proxyAwareFetch,
}));

vi.mock('@electron/utils/new-api-config', () => ({
  getNewApiConfig: (...args: unknown[]) => getNewApiConfigMock(...args),
}));

const DEFAULT_CONFIG = {
  baseUrl: 'https://newapi.example.com',
  apiLabel: 'New API',
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
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('new api service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getNewApiConfigMock.mockResolvedValue(DEFAULT_CONFIG);
  });

  it('getUserSelf extracts user info from the access-token self endpoint', async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      success: true,
      data: { id: 42, username: 'jit-user', quota: 500, used_quota: 100, request_count: 19 },
    }));

    const { getUserSelf } = await import('@electron/services/new-api-service');
    const user = await getUserSelf('access-token-123');

    expect(proxyAwareFetch).toHaveBeenCalledWith(
      'https://newapi.example.com/api/user/self/access-token',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token-123' }),
      }),
    );
    expect(user).toEqual({ id: 42, username: 'jit-user', quota: 500, usedQuota: 100, requestCount: 19 });
  });

  it('getUserSelf falls back to the legacy self endpoint when the access-token endpoint is unavailable', async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ message: 'not found' }, 404))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        data: { id: 42, username: 'jit-user', quota: 500, used_quota: 100, request_count: 19 },
      }));

    const { getUserSelf } = await import('@electron/services/new-api-service');
    const user = await getUserSelf('access-token-123');

    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      1,
      'https://newapi.example.com/api/user/self/access-token',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token-123' }),
      }),
    );
    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      2,
      'https://newapi.example.com/api/user/self',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token-123' }),
      }),
    );
    expect(user.id).toBe(42);
  });

  it('listNewApiTokens fetches tokens with New-Api-User header', async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      success: true,
      data: {
        items: [
          { id: 1, name: 'default', key: 'sk-abc', group: 'default', status: 1, remain_quota: 200, unlimited_quota: false, expired_time: -1 },
          { id: 2, name: 'expired', key: 'sk-def', group: 'vip', status: 1, remain_quota: 50, unlimited_quota: false, expired_time: 1000 },
        ],
        total: 2,
      },
    }));

    const { listNewApiTokens } = await import('@electron/services/new-api-service');
    const tokens = await listNewApiTokens('access-token-123', 42);

    expect(proxyAwareFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/token/'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'New-Api-User': '42',
        }),
      }),
    );
    expect(tokens).toHaveLength(2);
    expect(tokens[0].key).toBe('sk-abc');
    expect(tokens[0].group).toBe('default');
  });

  it('pickBestApiKey fetches the full key for the best usable token', async () => {
    // getUserSelf
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      success: true,
      data: { id: 42, username: 'jit-user', quota: 500, used_quota: 100, request_count: 10 },
    }));
    // listNewApiTokens
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      success: true,
      data: {
        items: [
          { id: 1, name: 'disabled', key: 'uuzM********masked1', group: 'vip', status: 0, remain_quota: 999, unlimited_quota: true, expired_time: -1 },
          { id: 2, name: 'empty-quota', key: 'uuzM********masked2', group: 'default', status: 1, remain_quota: 0, unlimited_quota: false, expired_time: -1 },
          { id: 3, name: 'best-token', key: 'uuzM********masked3', group: '', status: 1, remain_quota: 10, unlimited_quota: true, expired_time: -1 },
        ],
        total: 3,
      },
    }));
    // get full key
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      success: true,
      data: { key: 'uuzMhVKttgzp7A1d99drLbdlDOLeso4pxic4NR8Ugd6lkwF7' },
    }));

    const { pickBestApiKey } = await import('@electron/services/new-api-service');
    const result = await pickBestApiKey('access-token-123');

    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      3,
      'https://newapi.example.com/api/token/3/key',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'New-Api-User': '42',
        }),
      }),
    );
    expect(result).toEqual({
      apiKey: 'uuzMhVKttgzp7A1d99drLbdlDOLeso4pxic4NR8Ugd6lkwF7',
      tokenName: 'best-token',
    });
  });

  it('pickBestApiKey returns null when no usable token is available', async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      success: true,
      data: { id: 42, username: 'jit-user', quota: 500, used_quota: 100, request_count: 0 },
    }));
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      success: true,
      data: {
        items: [
          { id: 1, name: 'expired', key: 'uuzM********masked1', group: 'vip', status: 1, remain_quota: 100, unlimited_quota: false, expired_time: 1000 },
          { id: 2, name: 'disabled', key: 'uuzM********masked2', group: 'default', status: 0, remain_quota: 100, unlimited_quota: true, expired_time: -1 },
        ],
        total: 2,
      },
    }));

    const { pickBestApiKey } = await import('@electron/services/new-api-service');
    const result = await pickBestApiKey('access-token-123');

    expect(result).toBeNull();
  });

  it('getNewApiUsageOverview combines account, billing, and logs', async () => {
    // getUserSelf
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      success: true,
      data: { id: 42, username: 'jit-user', quota: 500, used_quota: 100, request_count: 19 },
    }));
    // billingSubscription (TokenAuth)
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      object: 'billing_subscription',
      hard_limit_usd: 50.0,
    }));
    // billingUsage (TokenAuth)
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      object: 'list',
      total_usage: 1234,
    }));
    // logSelf (UserAuth)
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      success: true,
      data: {
        items: [
          { id: 11, created_at: 1710002000, model_name: 'gpt-4.1-mini', token_name: 'default', prompt_tokens: 12, completion_tokens: 4, quota: 120 },
        ],
      },
    }));

    const { getNewApiUsageOverview } = await import('@electron/services/new-api-service');
    const result = await getNewApiUsageOverview('access-token-123', 'sk-inference');

    expect(result).toEqual({
      account: { username: 'jit-user', quota: 500, usedQuota: 100, requestCount: 19 },
      billing: { hardLimitUsd: 50.0, totalUsageUsd: 12.34 },
      logs: [
        { id: '11', createdAt: 1710002000, modelName: 'gpt-4.1-mini', tokenName: 'default', promptTokens: 12, completionTokens: 4, totalTokens: 16, quota: 120 },
      ],
    });
  });

  it('getNewApiUsageOverview returns null billing when no inference key', async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      success: true,
      data: { id: 42, username: 'jit-user', quota: 500, used_quota: 100, request_count: 5 },
    }));
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      success: true,
      data: { items: [] },
    }));

    const { getNewApiUsageOverview } = await import('@electron/services/new-api-service');
    const result = await getNewApiUsageOverview('access-token-123', null);

    expect(result.billing).toBeNull();
    expect(result.account.username).toBe('jit-user');
  });

  it('getNewApiUsageOverview still returns billing when only an inference key is available', async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      object: 'billing_subscription',
      hard_limit_usd: 50.0,
    }));
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      object: 'list',
      total_usage: 1234,
    }));

    const { getNewApiUsageOverview } = await import('@electron/services/new-api-service');
    const result = await getNewApiUsageOverview(null, 'sk-inference');

    expect(result.account).toEqual({
      username: undefined,
      quota: undefined,
      usedQuota: undefined,
      requestCount: undefined,
    });
    expect(result.billing).toEqual({
      hardLimitUsd: 50,
      totalUsageUsd: 12.34,
    });
    expect(result.logs).toEqual([]);
  });

  it('getNewApiTopupInfo keeps only epay methods and normalizes minimum amounts', async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        data: { id: 42, username: 'jit-user', quota: 500, used_quota: 100, request_count: 5 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        data: {
          enable_online_topup: true,
          min_topup: 10,
          amount_options: [10, '20', 'invalid'],
          pay_methods: [
            { name: 'Alipay', type: 'alipay', color: '#1677FF', min_topup: '10' },
            { name: 'WeChat Pay', type: 'wxpay', min_topup: 20 },
            { name: 'Stripe', type: 'stripe', min_topup: 10 },
            { name: 'Waffo', type: 'waffo', min_topup: 10 },
          ],
        },
      }));

    const { getNewApiTopupInfo } = await import('@electron/services/new-api-service');
    const result = await getNewApiTopupInfo('access-token-123');

    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      2,
      'https://newapi.example.com/api/user/topup/info',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'New-Api-User': '42',
        }),
      }),
    );
    expect(result).toEqual({
      enabled: true,
      minTopup: 10,
      amountOptions: [10, 20],
      payMethods: [
        { name: 'Alipay', type: 'alipay', color: '#1677FF', minTopup: 10 },
        { name: 'WeChat Pay', type: 'wxpay', color: undefined, minTopup: 20 },
      ],
    });
  });

  it('requestNewApiEpay returns the payment url and form parameters', async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        data: { id: 42, username: 'jit-user', quota: 500, used_quota: 100, request_count: 5 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        message: 'success',
        data: {
          pid: '10001',
          out_trade_no: 'order-123',
          sign: 'signature',
        },
        url: 'https://pay.example.com/submit',
      }));

    const { requestNewApiEpay } = await import('@electron/services/new-api-service');
    const result = await requestNewApiEpay('access-token-123', 20, 'alipay');

    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      2,
      'https://newapi.example.com/api/user/pay',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'New-Api-User': '42',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          amount: 20,
          payment_method: 'alipay',
        }),
      }),
    );
    expect(result).toEqual({
      paymentUrl: 'https://pay.example.com/submit',
      formParams: {
        pid: '10001',
        out_trade_no: 'order-123',
        sign: 'signature',
      },
    });
  });

  it('requestNewApiEpay surfaces upstream payment errors from successful HTTP responses', async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        data: { id: 42, username: 'jit-user', quota: 500, used_quota: 100, request_count: 5 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        message: 'error',
        data: '当前管理员未配置支付信息',
      }));

    const { requestNewApiEpay } = await import('@electron/services/new-api-service');

    await expect(requestNewApiEpay('access-token-123', 20, 'alipay')).rejects.toThrow('当前管理员未配置支付信息');
  });
});
