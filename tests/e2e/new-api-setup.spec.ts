import { expect, test } from './fixtures/electron';

test.describe('JitClaw New API setup', () => {
  test('collects an access token during first-run setup', async ({ page }) => {
    await expect(page.getByTestId('setup-page')).toBeVisible();
    await page.getByTestId('setup-next-button').click();

    const nextButton = page.getByTestId('setup-next-button');
    await expect(nextButton).toBeEnabled({ timeout: 45_000 });
    await nextButton.click({ force: true });

    await expect(page.getByTestId('setup-api-key-step')).toBeVisible();
    await expect(page.getByTestId('setup-new-api-key-input')).toBeVisible();

    await page.getByTestId('setup-new-api-key-input').fill('test-access-token-32chars00000');
    await page.getByTestId('setup-new-api-save-button').click();

    await expect(page.getByTestId('setup-api-key-saved')).toBeVisible();
    await expect(page.getByTestId('setup-new-api-key-input')).toHaveValue('test-access-token-32chars00000');
    await expect(page.getByTestId('setup-new-api-key-input')).toHaveAttribute('type', 'password');
    await page.getByTestId('setup-new-api-key-visibility-toggle').click();
    await expect(page.getByTestId('setup-new-api-key-input')).toHaveAttribute('type', 'text');
    await expect(nextButton).toBeEnabled();
  });
});
