import { completeSetup, expect, test } from './fixtures/electron';

const TEST_ACCESS_TOKEN = 'test-access-token-32chars00000';

async function openUsagePage(page: Parameters<typeof completeSetup>[0]): Promise<void> {
  await page.getByTestId('sidebar-nav-models').click();
  await expect(page.getByTestId('models-page')).toBeVisible();
  await expect(page.getByTestId('new-api-usage-card')).toBeVisible();
}

async function saveAccessToken(page: Parameters<typeof completeSetup>[0]): Promise<void> {
  await page.getByTestId('usage-api-key-input').fill(TEST_ACCESS_TOKEN);
  await page.getByTestId('usage-api-key-save-button').click();
  await expect(page.getByTestId('usage-api-key-saved')).toBeVisible();
}

test.describe('JitClaw New API lifecycle', () => {
  test('keeps the access token configured state after relaunch', async ({ electronApp, launchElectronApp, page }) => {
    await completeSetup(page);
    await openUsagePage(page);
    await saveAccessToken(page);

    await electronApp.close();

    const relaunchedApp = await launchElectronApp();
    try {
      const relaunchedPage = await relaunchedApp.firstWindow();
      await relaunchedPage.waitForLoadState('domcontentloaded');
      await expect(relaunchedPage.getByTestId('main-layout')).toBeVisible();

      await openUsagePage(relaunchedPage);
      await expect(relaunchedPage.getByTestId('usage-api-key-saved')).toBeVisible();
      await expect(relaunchedPage.getByTestId('usage-remote-log-entry').getByText('gpt-4.1-mini')).toBeVisible();
    } finally {
      await relaunchedApp.close();
    }
  });
});
