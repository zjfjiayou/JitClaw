import { completeSetup, expect, test } from './fixtures/electron';

async function openUsagePage(page: Parameters<typeof completeSetup>[0]): Promise<void> {
  await page.getByTestId('sidebar-nav-models').click();
  await expect(page.getByTestId('models-page')).toBeVisible();
}

test.describe('JitClaw usage page', () => {
  test('shows only remote usage data after saving the access token', async ({ page }) => {
    await completeSetup(page);
    await openUsagePage(page);

    await page.getByTestId('usage-api-key-input').fill('test-access-token-32chars00000');
    await page.getByTestId('usage-api-key-save-button').click();

    await expect(page.getByTestId('usage-api-key-saved')).toBeVisible();
    await expect(page.getByTestId('new-api-usage-overview')).toBeVisible();
    await expect(page.getByTestId('new-api-usage-card')).not.toContainText(/Base URL|基础 URL|ベース URL/);
    await expect(page.getByTestId('new-api-usage-card')).not.toContainText(/Service|服务|サービス/);
    // Billing: hardLimit $120 - totalUsage $45.50 = balance $74.50
    await expect(page.getByTestId('new-api-usage-overview')).toContainText('74.5');
    await expect(page.getByTestId('new-api-usage-overview')).toContainText('45.5');
    await expect(page.getByTestId('new-api-usage-overview')).toContainText('19');
    await expect(page.getByTestId('new-api-usage-overview')).not.toContainText(/Quota|配额|クォータ/);
    await expect(page.getByTestId('new-api-usage-overview')).not.toContainText(/Limit|额度上限|上限/);
    // Log entries from /api/log/self
    await expect(page.getByTestId('usage-remote-log-entry')).toHaveCount(1);
    await expect(page.getByTestId('usage-remote-log-entry')).toContainText('gpt-4.1-mini');
    // No local token history on this page
    await expect(page.locator('[data-testid="token-usage-entry"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="token-usage-view-content"]')).toHaveCount(0);
  });

  test('opens the topup dialog and refreshes the remote billing summary after payment', async ({ page }) => {
    await completeSetup(page);
    await openUsagePage(page);

    await page.getByTestId('usage-api-key-input').fill('test-access-token-32chars00000');
    await page.getByTestId('usage-api-key-save-button').click();

    await expect(page.getByTestId('new-api-usage-overview')).toContainText('74.5');

    await page.getByTestId('usage-topup-open-button').click();
    await expect(page.getByTestId('topup-dialog')).toBeVisible();

    await page.getByTestId('topup-amount-input').fill('20');
    await page.getByTestId('topup-submit-button').click();

    await expect(page.getByTestId('topup-refresh-button')).toBeVisible();
    await page.getByTestId('topup-refresh-button').click();

    await expect(page.getByTestId('topup-dialog')).toHaveCount(0);
    await expect(page.getByTestId('new-api-usage-overview')).toContainText('104.5');
  });
});
