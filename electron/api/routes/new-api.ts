import type { IncomingMessage, ServerResponse } from 'http';
import {
  getUserSelf,
  getNewApiUsageOverview,
  getNewApiTopupInfo,
  requestNewApiEpay,
} from '../../services/new-api-service';
import {
  clearNewApiInferenceKey,
  ensureNewApiAccount,
  refreshNewApiInferenceKey,
  refreshNewApiInferenceKeySafely,
} from '../../services/new-api-runtime';
import { getApiKey, storeApiKey } from '../../utils/secure-storage';
import { launchExternalPostForm } from '../../utils/external-form-launcher';
import {
  getNewApiConfig,
  NEW_API_ACCOUNT_ID,
  NEW_API_ACCESS_TOKEN_ID,
} from '../../utils/new-api-config';
import {
  listNewApiModelOptions,
  NEW_API_RUNTIME_PROVIDER_KEY,
  resolveNewApiModelId,
} from '../../utils/new-api-models';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
        const picked = await refreshNewApiInferenceKey(ctx.gatewayManager);
        if (!picked) {
          await clearNewApiInferenceKey();
          sendJson(res, 200, {
            success: true,
            username: user.username,
            noInferenceKey: true,
          });
          return true;
        }

        storedNewInferenceKey = true;

        sendJson(res, 200, {
          success: true,
          username: user.username,
          tokenName: picked.tokenName,
          modelCount: listNewApiModelOptions().length,
        });
      } catch (error) {
        const changedAccessToken = Boolean(previousAccessToken && previousAccessToken !== accessToken);
        if (changedAccessToken || storedNewInferenceKey) {
          await clearNewApiInferenceKey();
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
        inferenceKey = (await refreshNewApiInferenceKeySafely(ctx.gatewayManager))?.apiKey ?? null;
      }

      let overview = await getNewApiUsageOverview(accessToken, inferenceKey);
      if (overview.billing === null && accessToken) {
        const refreshedInferenceKey = (await refreshNewApiInferenceKeySafely(ctx.gatewayManager))?.apiKey ?? null;
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
