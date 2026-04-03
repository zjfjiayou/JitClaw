import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Models } from '@/pages/Models';

const hostApiFetchMock = vi.fn();
const trackUiEventMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

const { gatewayState, settingsState } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789, pid: 42, connectedAt: '2026-03-31T00:00:00.000Z' },
  },
  settingsState: {
    devModeUnlocked: false,
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/telemetry', () => ({
  trackUiEvent: (...args: unknown[]) => trackUiEventMock(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'dashboard:usage.title') return 'Usage';
      if (key === 'dashboard:usage.subtitle') return 'Review New API usage and balance.';
      if (key === 'dashboard:usage.newApi.title') return 'Access Token';
      if (key === 'dashboard:usage.newApi.description') return 'Save your system access token to view billing, spend, and balance.';
      if (key === 'dashboard:usage.newApi.topup.button') return 'Top Up';
      if (key === 'dashboard:usage.newApi.topup.title') return 'Top Up Balance';
      if (key === 'dashboard:usage.newApi.topup.description') return 'Open a payment page to recharge your account.';
      if (key === 'dashboard:usage.newApi.topup.amount') return 'Amount';
      if (key === 'dashboard:usage.newApi.topup.amountPlaceholder') return 'Enter amount';
      if (key === 'dashboard:usage.newApi.topup.minAmount') return `Minimum ${options?.amount}`;
      if (key === 'dashboard:usage.newApi.topup.paymentMethod') return 'Payment Method';
      if (key === 'dashboard:usage.newApi.topup.loading') return 'Loading top up options...';
      if (key === 'dashboard:usage.newApi.topup.unavailable') return 'Top up unavailable';
      if (key === 'dashboard:usage.newApi.topup.submit') return 'Continue to Payment';
      if (key === 'dashboard:usage.newApi.topup.cancel') return 'Cancel';
      if (key === 'dashboard:usage.newApi.topup.paymentOpenedTitle') return 'Payment Opened';
      if (key === 'dashboard:usage.newApi.topup.paymentOpenedDescription') return 'Finish payment in your browser, then refresh.';
      if (key === 'dashboard:usage.newApi.topup.refresh') return 'I Finished, Refresh Balance';
      if (key === 'dashboard:usage.newApi.topup.close') return 'Close';
      if (key === 'dashboard:usage.newApi.topup.selectPaymentMethod') return 'Choose a payment method';
      if (key === 'dashboard:recentTokenHistory.title') return 'Local Token History';
      if (key === 'dashboard:usage.overview.balance') return `Balance ${options?.amount}`;
      if (key === 'dashboard:usage.overview.used') return `Used ${options?.amount}`;
      if (key === 'dashboard:usage.overview.balanceLabel') return 'Balance';
      if (key === 'dashboard:usage.overview.usedLabel') return 'Used';
      if (key === 'dashboard:usage.overview.hardLimitLabel') return 'Limit';
      if (key === 'dashboard:usage.overview.requests') return `Requests ${options?.count}`;
      if (key === 'dashboard:usage.overview.requestsLabel') return 'Requests';
      if (key === 'dashboard:usage.overview.quotaLabel') return 'Quota';
      if (key === 'dashboard:usage.overview.totalTokens') return `Tokens ${options?.count}`;
      if (key === 'dashboard:usage.remoteLogs.quota') return `Consumed ${options?.amount}`;
      if (key === 'dashboard:usage.remoteLogs.request') return `Request ${options?.id}`;
      return key;
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

describe('Models page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let apiKeySaved = false;
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/new-api/status') {
        return {
          baseUrl: 'https://newapi.example.com',
          accessToken: apiKeySaved ? 'test-access-token-32chars00000' : '',
          hasAccessToken: apiKeySaved,
          hasInferenceKey: apiKeySaved,
          configured: apiKeySaved,
          canInfer: apiKeySaved,
        };
      }

      if (path === '/api/new-api/key') {
        expect(init?.method).toBe('PUT');
        expect(init?.body).toBe(JSON.stringify({ accessToken: 'test-access-token-32chars00000' }));
        apiKeySaved = true;
        return {
          success: true,
          username: 'jit-user',
          tokenName: 'default',
          modelCount: 2,
        };
      }

      if (path === '/api/new-api/usage/overview') {
        return {
          account: {
            username: 'jit-user',
            quota: 120,
            usedQuota: 45,
            requestCount: 19,
          },
          billing: {
            hardLimitUsd: 50.0,
            totalUsageUsd: 12.34,
          },
          logs: [
            {
              id: 'req-1',
              createdAt: 1710002000,
              modelName: 'gpt-4.1-mini',
              totalTokens: 30,
              quota: 120,
            },
          ],
        };
      }

      if (path === '/api/usage/recent-token-history') {
        throw new Error('Local token history should not be requested on the usage page');
      }

      throw new Error(`Unexpected host API path: ${path}`);
    });
  });

  it('saves the access token and refreshes remote usage without requesting local history', async () => {
    render(<Models />);

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/new-api/status');
    });

    const apiKeyInput = await screen.findByTestId('usage-api-key-input');
    fireEvent.change(apiKeyInput, { target: { value: 'test-access-token-32chars00000' } });
    fireEvent.click(screen.getByTestId('usage-api-key-save-button'));

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith(
        '/api/new-api/key',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ accessToken: 'test-access-token-32chars00000' }),
        }),
      );
    });

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/new-api/usage/overview');
    });

    expect(screen.getByTestId('new-api-usage-overview')).toBeInTheDocument();
    expect(screen.getByText('Request req-1')).toBeInTheDocument();
    expect(screen.getByTestId('usage-remote-log-entry')).toHaveTextContent('1.2');
    expect(hostApiFetchMock.mock.calls).not.toContainEqual([
      '/api/usage/recent-token-history',
    ]);
  });

  it('hydrates the saved access token from status and keeps it hidden until toggled', async () => {
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/new-api/status') {
        return {
          baseUrl: 'https://newapi.example.com',
          accessToken: 'saved-access-token-32chars00000',
          hasAccessToken: true,
          hasInferenceKey: false,
          configured: true,
          canInfer: false,
          model: null,
        };
      }

      if (path === '/api/new-api/usage/overview') {
        return {
          account: {
            username: 'jit-user',
            requestCount: 19,
          },
          billing: null,
          logs: [],
        };
      }

      throw new Error(`Unexpected host API path: ${path}`);
    });

    render(<Models />);

    const apiKeyInput = await screen.findByTestId('usage-api-key-input');
    expect(apiKeyInput).toHaveValue('saved-access-token-32chars00000');
    expect(apiKeyInput).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByTestId('usage-api-key-visibility-toggle'));

    expect(apiKeyInput).toHaveAttribute('type', 'text');
  });

  it('shows the backend inference error instead of reporting noInferenceKey', async () => {
    let apiKeySaved = false;
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/new-api/status') {
        return {
          baseUrl: 'https://newapi.example.com',
          accessToken: apiKeySaved ? 'test-access-token-32chars00000' : '',
          hasAccessToken: apiKeySaved,
          hasInferenceKey: false,
          configured: apiKeySaved,
          canInfer: false,
          model: null,
        };
      }

      if (path === '/api/new-api/key') {
        expect(init?.method).toBe('PUT');
        apiKeySaved = true;
        return {
          success: true,
          inferenceError: 'gateway reload failed',
        };
      }

      if (path === '/api/new-api/usage/overview') {
        return {
          account: {
            username: 'jit-user',
            quota: 120,
            usedQuota: 45,
            requestCount: 19,
          },
          billing: null,
          logs: [],
        };
      }

      throw new Error(`Unexpected host API path: ${path}`);
    });

    render(<Models />);

    const apiKeyInput = await screen.findByTestId('usage-api-key-input');
    fireEvent.change(apiKeyInput, { target: { value: 'test-access-token-32chars00000' } });
    fireEvent.click(screen.getByTestId('usage-api-key-save-button'));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('gateway reload failed');
    });
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(await screen.findByTestId('no-inference-key-warning')).toBeInTheDocument();
  });

  it('opens the topup dialog, launches payment, and refreshes billing manually', async () => {
    let usageOverviewCalls = 0;

    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/new-api/status') {
        return {
          accessToken: 'saved-access-token-32chars00000',
          hasAccessToken: true,
          hasInferenceKey: true,
          configured: true,
          canInfer: true,
        };
      }

      if (path === '/api/new-api/usage/overview') {
        usageOverviewCalls += 1;
        return {
          account: {
            username: 'jit-user',
            requestCount: 19,
          },
          billing: {
            hardLimitUsd: usageOverviewCalls === 1 ? 50.0 : 70.0,
            totalUsageUsd: 12.34,
          },
          logs: [],
        };
      }

      if (path === '/api/new-api/topup/info') {
        return {
          enabled: true,
          minTopup: 10,
          amountOptions: [10, 20, 50],
          payMethods: [
            { name: 'Alipay', type: 'alipay', minTopup: 10 },
          ],
        };
      }

      if (path === '/api/new-api/topup/pay') {
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(JSON.stringify({ amount: 20, paymentMethod: 'alipay' }));
        return { success: true };
      }

      throw new Error(`Unexpected host API path: ${path}`);
    });

    render(<Models />);

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/new-api/usage/overview');
    });

    fireEvent.click(screen.getByTestId('usage-topup-open-button'));

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/new-api/topup/info');
    });

    fireEvent.change(screen.getByTestId('topup-amount-input'), { target: { value: '20' } });
    fireEvent.click(screen.getByTestId('topup-submit-button'));

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith(
        '/api/new-api/topup/pay',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ amount: 20, paymentMethod: 'alipay' }),
        }),
      );
    });

    expect(screen.getByTestId('topup-refresh-button')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('topup-refresh-button'));

    await waitFor(() => {
      expect(usageOverviewCalls).toBe(2);
    });
    expect(screen.queryByTestId('topup-dialog')).not.toBeInTheDocument();
    expect(hostApiFetchMock.mock.calls.filter(([path]) => path === '/api/new-api/usage/overview')).toHaveLength(2);
  });

  it('requires selecting a payment method when multiple epay methods are available', async () => {
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/new-api/status') {
        return {
          accessToken: 'saved-access-token-32chars00000',
          hasAccessToken: true,
          hasInferenceKey: true,
          configured: true,
          canInfer: true,
        };
      }

      if (path === '/api/new-api/usage/overview') {
        return {
          account: {
            username: 'jit-user',
            requestCount: 19,
          },
          billing: {
            hardLimitUsd: 50.0,
            totalUsageUsd: 12.34,
          },
          logs: [],
        };
      }

      if (path === '/api/new-api/topup/info') {
        return {
          enabled: true,
          minTopup: 10,
          amountOptions: [10, 20, 50],
          payMethods: [
            { name: 'Alipay', type: 'alipay', minTopup: 10 },
            { name: 'WeChat Pay', type: 'wxpay', minTopup: 10 },
          ],
        };
      }

      throw new Error(`Unexpected host API path: ${path}`);
    });

    render(<Models />);

    fireEvent.click(await screen.findByTestId('usage-topup-open-button'));
    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/new-api/topup/info');
    });

    fireEvent.change(screen.getByTestId('topup-amount-input'), { target: { value: '20' } });

    const submitButton = screen.getByTestId('topup-submit-button');
    expect(submitButton).toBeDisabled();

    fireEvent.click(screen.getByTestId('topup-payment-method-alipay'));

    expect(submitButton).not.toBeDisabled();
  });

  it('enforces the effective payment-method min topup in submit logic', async () => {
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/new-api/status') {
        return {
          accessToken: 'saved-access-token-32chars00000',
          hasAccessToken: true,
          hasInferenceKey: true,
          configured: true,
          canInfer: true,
        };
      }

      if (path === '/api/new-api/usage/overview') {
        return {
          account: {
            username: 'jit-user',
            requestCount: 19,
          },
          billing: {
            hardLimitUsd: 50.0,
            totalUsageUsd: 12.34,
          },
          logs: [],
        };
      }

      if (path === '/api/new-api/topup/info') {
        return {
          enabled: true,
          minTopup: 10,
          amountOptions: [10, 20, 50],
          payMethods: [
            { name: 'Alipay', type: 'alipay', minTopup: 50 },
          ],
        };
      }

      if (path === '/api/new-api/topup/pay') {
        return { success: true };
      }

      throw new Error(`Unexpected host API path: ${path}`);
    });

    render(<Models />);

    fireEvent.click(await screen.findByTestId('usage-topup-open-button'));
    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/new-api/topup/info');
    });

    const amountInput = screen.getByTestId('topup-amount-input');
    const submitButton = screen.getByTestId('topup-submit-button');

    fireEvent.change(amountInput, { target: { value: '20' } });
    expect(submitButton).toBeDisabled();

    fireEvent.click(submitButton);

    expect(hostApiFetchMock.mock.calls.some(([path]) => path === '/api/new-api/topup/pay')).toBe(false);
  });

  it('ignores stale topup info responses after close and reopen', async () => {
    let topupInfoCallCount = 0;
    let resolveFirstTopupInfo: ((value: {
      enabled: boolean;
      minTopup: number;
      amountOptions: number[];
      payMethods: Array<{ name: string; type: string; minTopup: number }>;
    }) => void) | null = null;

    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/new-api/status') {
        return {
          accessToken: 'saved-access-token-32chars00000',
          hasAccessToken: true,
          hasInferenceKey: true,
          configured: true,
          canInfer: true,
        };
      }

      if (path === '/api/new-api/usage/overview') {
        return {
          account: {
            username: 'jit-user',
            requestCount: 19,
          },
          billing: {
            hardLimitUsd: 50.0,
            totalUsageUsd: 12.34,
          },
          logs: [],
        };
      }

      if (path === '/api/new-api/topup/info') {
        topupInfoCallCount += 1;
        if (topupInfoCallCount === 1) {
          return new Promise((resolve) => {
            resolveFirstTopupInfo = resolve as typeof resolveFirstTopupInfo;
          });
        }

        return {
          enabled: true,
          minTopup: 10,
          amountOptions: [20],
          payMethods: [
            { name: 'Fresh Pay', type: 'fresh-pay', minTopup: 20 },
          ],
        };
      }

      throw new Error(`Unexpected host API path: ${path}`);
    });

    render(<Models />);

    fireEvent.click(await screen.findByTestId('usage-topup-open-button'));
    await waitFor(() => {
      expect(topupInfoCallCount).toBe(1);
    });

    fireEvent.click(screen.getByText('Close'));
    expect(screen.queryByTestId('topup-dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('usage-topup-open-button'));
    await waitFor(() => {
      expect(topupInfoCallCount).toBe(2);
    });

    const reopenedDialog = await screen.findByTestId('topup-dialog');
    expect(within(reopenedDialog).getByDisplayValue('20')).toBeInTheDocument();
    expect(within(reopenedDialog).getByTestId('topup-payment-method-fresh-pay')).toBeInTheDocument();

    resolveFirstTopupInfo?.({
      enabled: true,
      minTopup: 5,
      amountOptions: [5],
      payMethods: [
        { name: 'Stale Pay', type: 'stale-pay', minTopup: 5 },
      ],
    });

    await waitFor(() => {
      expect(within(screen.getByTestId('topup-dialog')).queryByTestId('topup-payment-method-stale-pay')).not.toBeInTheDocument();
    });
    expect(within(screen.getByTestId('topup-dialog')).getByDisplayValue('20')).toBeInTheDocument();
  });
});
