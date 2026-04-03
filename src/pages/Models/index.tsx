import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { hostApiFetch } from '@/lib/host-api';
import { trackUiEvent } from '@/lib/telemetry';
import { FeedbackState } from '@/components/common/FeedbackState';
import { toast } from 'sonner';

interface NewApiStatus {
  accessToken?: string | null;
  hasAccessToken?: boolean;
  hasInferenceKey?: boolean;
  configured?: boolean;
  canInfer?: boolean;
  inferenceTokenName?: string;
}

interface NewApiUsageOverview {
  account?: {
    username?: string;
    quota?: number;
    usedQuota?: number;
    requestCount?: number;
  };
  billing?: {
    hardLimitUsd?: number;
    totalUsageUsd?: number;
  } | null;
  logs?: Array<{
    id: string;
    createdAt?: number;
    modelName?: string;
    tokenName?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    quota?: number;
  }>;
}

interface NewApiPayMethod {
  name: string;
  type: string;
  color?: string;
  minTopup?: number;
}

interface NewApiTopupInfo {
  enabled?: boolean;
  minTopup?: number;
  amountOptions?: number[];
  payMethods?: NewApiPayMethod[];
}

function normalizeTopupPayMethods(value: unknown): NewApiPayMethod[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenTypes = new Set<string>();

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const type = typeof entry.type === 'string' ? entry.type.trim() : '';
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';

    if (!type || !name || seenTypes.has(type)) {
      return [];
    }

    seenTypes.add(type);

    return [{
      type,
      name,
      color: typeof entry.color === 'string' && entry.color.trim() ? entry.color : undefined,
      minTopup: isFiniteNumber(entry.minTopup) && entry.minTopup > 0 ? entry.minTopup : undefined,
    }];
  });
}

function getEffectiveMinTopup(info: NewApiTopupInfo | null, selectedMethod: string): number {
  const payMethods = Array.isArray(info?.payMethods) ? info.payMethods : [];
  const selectedPayMethod = payMethods.find((method) => method.type === selectedMethod);
  return selectedPayMethod?.minTopup ?? info?.minTopup ?? 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatAmount(value: number | undefined): string {
  if (!isFiniteNumber(value)) {
    return '—';
  }

  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 4,
  }).format(value);
}

function formatUsdAmountFromQuota(value: number | undefined): string {
  if (!isFiniteNumber(value)) {
    return '—';
  }

  return formatAmount(value / 100);
}

function formatUnixTimestamp(value: number | undefined): string | null {
  if (!isFiniteNumber(value)) {
    return null;
  }

  const timestamp = value > 1_000_000_000_000 ? value : value * 1000;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

interface TopupDialogProps {
  open: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
  loading: boolean;
  loadError: string | null;
  info: NewApiTopupInfo | null;
  amount: string;
  selectedMethod: string;
  submitting: boolean;
  refreshing: boolean;
  paymentOpened: boolean;
  onAmountChange: (value: string) => void;
  onSelectMethod: (value: string) => void;
  onSubmit: () => void;
  onRefresh: () => void;
  onClose: () => void;
}

function TopupDialog({
  open,
  t,
  loading,
  loadError,
  info,
  amount,
  selectedMethod,
  submitting,
  refreshing,
  paymentOpened,
  onAmountChange,
  onSelectMethod,
  onSubmit,
  onRefresh,
  onClose,
}: TopupDialogProps) {
  if (!open) {
    return null;
  }

  const payMethods = Array.isArray(info?.payMethods) ? info.payMethods : [];
  const effectiveMinTopup = getEffectiveMinTopup(info, selectedMethod);
  const parsedAmount = Number.parseInt(amount.trim(), 10);
  const canSubmit = (
    !loading
    && !loadError
    && Boolean(info?.enabled)
    && Number.isInteger(parsedAmount)
    && parsedAmount > 0
    && (!effectiveMinTopup || parsedAmount >= effectiveMinTopup)
    && Boolean(selectedMethod)
    && !paymentOpened
    && !submitting
  );

  return (
    <div data-testid="topup-dialog" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-[28px] border border-black/10 bg-background p-6 shadow-2xl dark:border-white/10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-serif text-foreground font-normal tracking-tight" style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}>
              {t('dashboard:usage.newApi.topup.title')}
            </h2>
            <p className="mt-2 text-[14px] text-muted-foreground">
              {t('dashboard:usage.newApi.topup.description')}
            </p>
          </div>
          <Button type="button" variant="outline" className="rounded-full" onClick={onClose}>
            {t('dashboard:usage.newApi.topup.close')}
          </Button>
        </div>

        <div className="mt-6">
          {loading ? (
            <div className="rounded-2xl border border-dashed border-black/10 p-6 dark:border-white/10">
              <FeedbackState state="loading" title={t('dashboard:usage.newApi.topup.loading')} />
            </div>
          ) : loadError ? (
            <div className="rounded-2xl border border-dashed border-destructive/30 bg-destructive/5 p-6">
              <FeedbackState state="error" title={t('dashboard:usage.newApi.topup.unavailable')} description={loadError} />
            </div>
          ) : !info?.enabled ? (
            <div className="rounded-2xl border border-dashed border-amber-500/30 bg-amber-500/10 p-6 text-[14px] font-medium text-amber-700 dark:text-amber-400">
              {t('dashboard:usage.newApi.topup.unavailable')}
            </div>
          ) : paymentOpened ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-green-500/30 bg-green-500/10 p-5">
                <p className="text-[16px] font-semibold text-foreground">
                  {t('dashboard:usage.newApi.topup.paymentOpenedTitle')}
                </p>
                <p className="mt-2 text-[14px] text-muted-foreground">
                  {t('dashboard:usage.newApi.topup.paymentOpenedDescription')}
                </p>
              </div>
              <div className="flex flex-col-reverse gap-3 md:flex-row md:justify-end">
                <Button type="button" variant="outline" className="rounded-full px-5" onClick={onClose}>
                  {t('dashboard:usage.newApi.topup.close')}
                </Button>
                <Button
                  data-testid="topup-refresh-button"
                  type="button"
                  className="rounded-full px-5"
                  onClick={onRefresh}
                  disabled={refreshing}
                >
                  {refreshing ? t('dashboard:usage.overview.loading') : t('dashboard:usage.newApi.topup.refresh')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="topup-amount-input" className="text-sm font-semibold">
                  {t('dashboard:usage.newApi.topup.amount')}
                </Label>
                <Input
                  data-testid="topup-amount-input"
                  id="topup-amount-input"
                  type="number"
                  min={effectiveMinTopup || 1}
                  step={1}
                  value={amount}
                  onChange={(event) => onAmountChange(event.target.value)}
                  placeholder={t('dashboard:usage.newApi.topup.amountPlaceholder')}
                />
                <p className="text-[12px] text-muted-foreground">
                  {t('dashboard:usage.newApi.topup.minAmount', { amount: effectiveMinTopup })}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold">
                  {t('dashboard:usage.newApi.topup.paymentMethod')}
                </Label>
                <div className="flex flex-wrap gap-2">
                  {payMethods.map((method) => {
                    const selected = selectedMethod === method.type;
                    return (
                      <Button
                        key={method.type}
                        data-testid={`topup-payment-method-${method.type}`}
                        type="button"
                        variant={selected ? 'default' : 'outline'}
                        className="rounded-full px-4"
                        onClick={() => onSelectMethod(method.type)}
                      >
                        {method.name}
                      </Button>
                    );
                  })}
                </div>
                {payMethods.length > 1 && !selectedMethod && (
                  <p className="text-[12px] text-muted-foreground">
                    {t('dashboard:usage.newApi.topup.selectPaymentMethod')}
                  </p>
                )}
              </div>

              <div className="flex flex-col-reverse gap-3 md:flex-row md:justify-end">
                <Button type="button" variant="outline" className="rounded-full px-5" onClick={onClose}>
                  {t('dashboard:usage.newApi.topup.cancel')}
                </Button>
                <Button
                  data-testid="topup-submit-button"
                  type="button"
                  className="rounded-full px-5"
                  onClick={onSubmit}
                  disabled={!canSubmit}
                >
                  {submitting ? t('common:status.saving') : t('dashboard:usage.newApi.topup.submit')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function Models() {
  const { t } = useTranslation(['dashboard', 'settings', 'common']);
  const [newApiStatus, setNewApiStatus] = useState<NewApiStatus | null>(null);
  const [accessToken, setAccessToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [newApiOverview, setNewApiOverview] = useState<NewApiUsageOverview | null>(null);
  const [topupDialogOpen, setTopupDialogOpen] = useState(false);
  const [topupInfo, setTopupInfo] = useState<NewApiTopupInfo | null>(null);
  const [topupInfoLoading, setTopupInfoLoading] = useState(false);
  const [topupInfoError, setTopupInfoError] = useState<string | null>(null);
  const [topupAmount, setTopupAmount] = useState('');
  const [selectedTopupMethod, setSelectedTopupMethod] = useState('');
  const [topupSubmitting, setTopupSubmitting] = useState(false);
  const [topupRefreshLoading, setTopupRefreshLoading] = useState(false);
  const [topupPaymentOpened, setTopupPaymentOpened] = useState(false);
  const topupInfoRequestIdRef = useRef(0);

  const loadNewApiStatus = useCallback(async (): Promise<NewApiStatus | null> => {
    try {
      const status = await hostApiFetch<NewApiStatus>('/api/new-api/status');
      const normalizedStatus: NewApiStatus = {
        accessToken: typeof status?.accessToken === 'string' ? status.accessToken : null,
        hasAccessToken: Boolean(status?.hasAccessToken),
        hasInferenceKey: Boolean(status?.hasInferenceKey),
        configured: Boolean(status?.configured),
        canInfer: Boolean(status?.canInfer),
        inferenceTokenName: status?.inferenceTokenName,
      };
      if (typeof normalizedStatus.accessToken === 'string') {
        setAccessToken(normalizedStatus.accessToken);
      } else if (!normalizedStatus.hasAccessToken) {
        setAccessToken('');
      }
      setNewApiStatus(normalizedStatus);
      return normalizedStatus;
    } catch (error) {
      setNewApiStatus(null);
      setNewApiOverview(null);
      setOverviewError(error instanceof Error ? error.message : String(error));
      return null;
    }
  }, []);

  const loadNewApiOverview = useCallback(async (): Promise<boolean> => {
    setOverviewLoading(true);
    setOverviewError(null);

    try {
      const overview = await hostApiFetch<NewApiUsageOverview>('/api/new-api/usage/overview');
      setNewApiOverview({
        account: overview?.account,
        billing: overview?.billing,
        logs: Array.isArray(overview?.logs) ? overview.logs : [],
      });
      return true;
    } catch (error) {
      setNewApiOverview(null);
      setOverviewError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadTopupInfo = useCallback(async () => {
    const requestId = topupInfoRequestIdRef.current + 1;
    topupInfoRequestIdRef.current = requestId;
    setTopupInfoLoading(true);
    setTopupInfoError(null);

    try {
      const info = await hostApiFetch<NewApiTopupInfo>('/api/new-api/topup/info');
      if (topupInfoRequestIdRef.current !== requestId) {
        return;
      }

      const normalizedPayMethods = normalizeTopupPayMethods(info?.payMethods);
      const normalizedInfo: NewApiTopupInfo = {
        enabled: Boolean(info?.enabled),
        minTopup: isFiniteNumber(info?.minTopup) && info.minTopup > 0 ? info.minTopup : 0,
        amountOptions: Array.isArray(info?.amountOptions)
          ? info.amountOptions.filter((value): value is number => isFiniteNumber(value) && value > 0)
          : [],
        payMethods: normalizedPayMethods,
      };

      setTopupInfo(normalizedInfo);
      setSelectedTopupMethod(normalizedPayMethods.length === 1 ? normalizedPayMethods[0].type : '');
      setTopupAmount((current) => {
        if (current.trim()) {
          return current;
        }
        if (normalizedInfo.amountOptions && normalizedInfo.amountOptions.length > 0) {
          return String(normalizedInfo.amountOptions[0]);
        }
        if (normalizedInfo.minTopup && normalizedInfo.minTopup > 0) {
          return String(normalizedInfo.minTopup);
        }
        return '';
      });
    } catch (error) {
      if (topupInfoRequestIdRef.current !== requestId) {
        return;
      }
      setTopupInfo(null);
      setTopupInfoError(error instanceof Error ? error.message : String(error));
    } finally {
      if (topupInfoRequestIdRef.current === requestId) {
        setTopupInfoLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    trackUiEvent('usage.page_viewed');
    void loadNewApiStatus().then((status) => {
      if (status?.configured || status?.canInfer) {
        void loadNewApiOverview();
      }
    });
  }, [loadNewApiOverview, loadNewApiStatus]);
  const hasAccessToken = Boolean(newApiStatus?.configured);
  const canInfer = Boolean(newApiStatus?.canInfer);
  const canLoadOverview = hasAccessToken || canInfer;
  const recentApiLogs = Array.isArray(newApiOverview?.logs) ? newApiOverview.logs : [];

  const handleOpenTopupDialog = () => {
    setTopupDialogOpen(true);
    setTopupPaymentOpened(false);
    setTopupSubmitting(false);
    setTopupRefreshLoading(false);
    setTopupInfoError(null);
    setTopupAmount('');
    setSelectedTopupMethod('');
    void loadTopupInfo();
  };

  const handleCloseTopupDialog = () => {
    topupInfoRequestIdRef.current += 1;
    setTopupDialogOpen(false);
    setTopupPaymentOpened(false);
    setTopupSubmitting(false);
    setTopupRefreshLoading(false);
    setTopupInfoError(null);
    setTopupInfoLoading(false);
  };

  const handleSaveAccessToken = async () => {
    const trimmed = accessToken.trim();
    if (!trimmed) {
      return;
    }

    setSaving(true);
    try {
      const result = await hostApiFetch<{ success: boolean; noInferenceKey?: boolean; inferenceError?: string }>('/api/new-api/key', {
        method: 'PUT',
        body: JSON.stringify({ accessToken: trimmed }),
      });
      setAccessToken(trimmed);
      setShowToken(false);

      if (result.inferenceError) {
        toast.error(result.inferenceError);
      } else if (result.noInferenceKey) {
        toast.error(t('dashboard:usage.newApi.noInferenceKey'));
      } else {
        toast.success(t('dashboard:usage.newApi.saved'));
      }

      const nextStatus = await loadNewApiStatus();
      if (nextStatus?.configured || nextStatus?.canInfer) {
        await loadNewApiOverview();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitTopup = async () => {
    const amount = Number.parseInt(topupAmount.trim(), 10);
    const effectiveMinTopup = getEffectiveMinTopup(topupInfo, selectedTopupMethod);
    if (
      !topupInfo?.enabled
      || !Number.isInteger(amount)
      || amount <= 0
      || !selectedTopupMethod
      || (effectiveMinTopup > 0 && amount < effectiveMinTopup)
    ) {
      return;
    }

    setTopupSubmitting(true);
    try {
      await hostApiFetch<{ success: boolean }>('/api/new-api/topup/pay', {
        method: 'POST',
        body: JSON.stringify({
          amount,
          paymentMethod: selectedTopupMethod,
        }),
      });
      setTopupPaymentOpened(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setTopupSubmitting(false);
    }
  };

  const handleRefreshAfterTopup = async () => {
    setTopupRefreshLoading(true);
    try {
      const refreshed = await loadNewApiOverview();
      if (refreshed) {
        handleCloseTopupDialog();
      }
    } finally {
      setTopupRefreshLoading(false);
    }
  };

  return (
    <div data-testid="models-page" className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-5xl mx-auto flex flex-col h-full p-10 pt-16">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-12 shrink-0 gap-4">
          <div>
            <h1 data-testid="models-page-title" className="text-5xl md:text-6xl font-serif text-foreground mb-3 font-normal tracking-tight" style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}>
              {t('dashboard:usage.title')}
            </h1>
            <p className="text-[17px] text-foreground/70 font-medium">
              {t('dashboard:usage.subtitle')}
            </p>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2 space-y-12">

          <section
            data-testid="new-api-usage-card"
            className="rounded-[28px] border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.03] p-6 md:p-7 space-y-6"
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-3xl font-serif text-foreground font-normal tracking-tight" style={{ fontFamily: 'Georgia, Cambria, \"Times New Roman\", Times, serif' }}>
                  {t('dashboard:usage.newApi.title')}
                </h2>
                <p className="mt-2 max-w-2xl text-[15px] text-muted-foreground">
                  {t('dashboard:usage.newApi.description')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {hasAccessToken && (
                  <div
                    data-testid="usage-api-key-saved"
                    className="inline-flex items-center gap-2 rounded-full bg-green-500/10 px-3 py-1 text-[12px] font-medium text-green-600 dark:text-green-400"
                  >
                    {t('dashboard:usage.newApi.configured')}
                  </div>
                )}
                {hasAccessToken && (
                  <Button
                    data-testid="usage-topup-open-button"
                    type="button"
                    variant="outline"
                    className="rounded-full px-4"
                    onClick={handleOpenTopupDialog}
                  >
                    {t('dashboard:usage.newApi.topup.button')}
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-black/10 dark:border-white/10 bg-background/70 p-4">
              <div className="flex items-center gap-2 text-foreground">
                <KeyRound className="h-4 w-4" />
                <Label htmlFor="usage-api-key-input" className="text-sm font-semibold">
                  {t('dashboard:usage.newApi.accessToken')}
                </Label>
              </div>
              <div className="flex flex-col gap-3 md:flex-row">
                <div className="relative flex-1">
                  <Input
                    data-testid="usage-api-key-input"
                    id="usage-api-key-input"
                    type={showToken ? 'text' : 'password'}
                    value={accessToken}
                    onChange={(event) => setAccessToken(event.target.value)}
                    placeholder={t('dashboard:usage.newApi.accessTokenPlaceholder')}
                    className="pr-10 font-mono"
                    autoComplete="off"
                  />
                  <button
                    data-testid="usage-api-key-visibility-toggle"
                    type="button"
                    onClick={() => setShowToken((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showToken ? t('common:actions.hide') : t('common:actions.show')}
                  >
                    {showToken ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                </div>
                <Button
                  data-testid="usage-api-key-save-button"
                  onClick={() => void handleSaveAccessToken()}
                  disabled={!accessToken.trim() || saving}
                  className="h-10 rounded-full px-6"
                >
                  {saving ? t('common:status.saving') : t('common:actions.save')}
                </Button>
              </div>
              <p className="text-[13px] text-muted-foreground">
                {t('dashboard:usage.newApi.accessTokenHelp')}
              </p>
            </div>

            {hasAccessToken && !newApiStatus?.canInfer && !overviewLoading && (
              <div
                data-testid="no-inference-key-warning"
                className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-[14px] font-medium text-amber-700 dark:text-amber-400"
              >
                {t('dashboard:usage.newApi.noInferenceKey')}
              </div>
            )}

            {!canLoadOverview ? (
              <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 p-6 text-center text-[14px] font-medium text-muted-foreground">
                {t('dashboard:usage.newApi.pending')}
              </div>
            ) : overviewLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-3xl border border-transparent border-dashed">
                <FeedbackState state="loading" title={t('dashboard:usage.overview.loading')} />
              </div>
            ) : overviewError ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-3xl border border-transparent border-dashed">
                <FeedbackState state="error" title={t('dashboard:usage.overview.error')} description={overviewError} />
              </div>
            ) : (
              <div data-testid="new-api-usage-overview" className="space-y-6">
                {newApiOverview?.billing && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-background/70 p-4">
                      <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        {t('dashboard:usage.overview.balanceLabel')}
                      </p>
                      <p className="mt-2 text-[16px] font-semibold text-foreground">
                        {t('dashboard:usage.overview.balance', {
                          amount: formatAmount(
                            isFiniteNumber(newApiOverview.billing.hardLimitUsd) && isFiniteNumber(newApiOverview.billing.totalUsageUsd)
                              ? newApiOverview.billing.hardLimitUsd - newApiOverview.billing.totalUsageUsd
                              : undefined,
                          ),
                        })}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-background/70 p-4">
                      <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        {t('dashboard:usage.overview.usedLabel')}
                      </p>
                      <p className="mt-2 text-[16px] font-semibold text-foreground">
                        {t('dashboard:usage.overview.used', {
                          amount: formatAmount(newApiOverview.billing.totalUsageUsd),
                        })}
                      </p>
                    </div>
                  </div>
                )}
                <div className="grid gap-3 md:grid-cols-1">
                  <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-background/70 p-4">
                    <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      {t('dashboard:usage.overview.requestsLabel')}
                    </p>
                    <p className="mt-2 text-[16px] font-semibold text-foreground">
                      {t('dashboard:usage.overview.requests', {
                        count: formatAmount(newApiOverview?.account?.requestCount),
                      })}
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-background/70 p-4 md:p-5">
                  <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
                    <div>
                      <h3 className="text-[18px] font-semibold text-foreground">
                        {t('dashboard:usage.remoteLogs.title')}
                      </h3>
                      <p className="text-[13px] text-muted-foreground">
                        {t('dashboard:usage.remoteLogs.description')}
                      </p>
                    </div>
                    {newApiOverview?.account?.username && (
                      <p className="text-[13px] text-muted-foreground">
                        {t('dashboard:usage.remoteLogs.account', {
                          user: newApiOverview.account.username,
                        })}
                      </p>
                    )}
                  </div>

                  {recentApiLogs.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-dashed border-black/10 dark:border-white/10 p-6 text-center text-[14px] font-medium text-muted-foreground">
                      {t('dashboard:usage.remoteLogs.empty')}
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {recentApiLogs.map((entry) => (
                        <div
                          key={entry.id}
                          data-testid="usage-remote-log-entry"
                          className="rounded-2xl border border-black/10 dark:border-white/10 p-4"
                        >
                          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0">
                              <p className="truncate text-[15px] font-semibold text-foreground">
                                {entry.modelName || entry.tokenName || t('dashboard:recentTokenHistory.unknownModel')}
                              </p>
                              <p className="mt-1 text-[13px] text-muted-foreground">
                                {t('dashboard:usage.remoteLogs.request', { id: entry.id })}
                              </p>
                            </div>
                            <div className="text-[13px] text-muted-foreground">
                              {formatUnixTimestamp(entry.createdAt) || t('dashboard:usage.remoteLogs.unknownTime')}
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-3 text-[12.5px] font-medium text-muted-foreground">
                            {isFiniteNumber(entry.totalTokens) && (
                              <span>{t('dashboard:recentTokenHistory.totalTokens')}: {formatAmount(entry.totalTokens)}</span>
                            )}
                            {isFiniteNumber(entry.promptTokens) && (
                              <span>{t('dashboard:recentTokenHistory.input', { value: formatAmount(entry.promptTokens) })}</span>
                            )}
                            {isFiniteNumber(entry.completionTokens) && (
                              <span>{t('dashboard:recentTokenHistory.output', { value: formatAmount(entry.completionTokens) })}</span>
                            )}
                            {isFiniteNumber(entry.quota) && (
                              <span>{t('dashboard:usage.remoteLogs.quota', { amount: formatUsdAmountFromQuota(entry.quota) })}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
      <TopupDialog
        open={topupDialogOpen}
        t={t}
        loading={topupInfoLoading}
        loadError={topupInfoError}
        info={topupInfo}
        amount={topupAmount}
        selectedMethod={selectedTopupMethod}
        submitting={topupSubmitting}
        refreshing={topupRefreshLoading}
        paymentOpened={topupPaymentOpened}
        onAmountChange={setTopupAmount}
        onSelectMethod={setSelectedTopupMethod}
        onSubmit={() => void handleSubmitTopup()}
        onRefresh={() => void handleRefreshAfterTopup()}
        onClose={handleCloseTopupDialog}
      />
    </div>
  );
}

export default Models;
