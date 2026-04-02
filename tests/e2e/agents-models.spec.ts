import { completeSetup, expect, test } from './fixtures/electron';

async function saveAccessToken(page: Parameters<typeof completeSetup>[0]): Promise<void> {
  await page.getByTestId('sidebar-nav-models').click();
  await expect(page.getByTestId('models-page')).toBeVisible();

  await page.getByTestId('usage-api-key-input').fill('test-access-token-32chars00000');
  await page.getByTestId('usage-api-key-save-button').click();
  await expect(page.getByTestId('usage-api-key-saved')).toBeVisible();
}

test.describe('JitClaw agent model settings', () => {
  test('shows bundled New API model options without showing a provider selector', async ({ page }) => {
    await completeSetup(page);
    await saveAccessToken(page);

    await page.getByTestId('sidebar-nav-agents').click();
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Main Agent' })).toBeVisible();
    await page.locator('main').getByRole('button', { name: '设置' }).click();
    await page.getByRole('button', { name: /Model .*custom-newapi\/gpt-5\.4/ }).click();

    await expect(page.getByTestId('agent-model-modal')).toBeVisible();
    await expect(page.locator('#agent-model-provider')).toHaveCount(0);

    const modelSelect = page.locator('#agent-model-id');
    await expect(modelSelect).toBeVisible();
    await expect(modelSelect.locator('option')).toContainText(['gpt-5.4', 'gpt-5.3-codex']);
  });
});
