import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { shell } from 'electron';

function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function buildAutoSubmitHtml(actionUrl: string, formParams: Record<string, string>): string {
  const payload = serializeForInlineScript({ actionUrl, formParams });
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>JitClaw Payment Redirect</title>
  </head>
  <body>
    <p>Redirecting to the payment page...</p>
    <script>
      const payload = ${payload};
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = payload.actionUrl;
      for (const [name, value] of Object.entries(payload.formParams || {})) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = String(value);
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    </script>
  </body>
</html>`;
}

export async function launchExternalPostForm(
  actionUrl: string,
  formParams: Record<string, string>,
): Promise<void> {
  const parsed = new URL(actionUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported payment protocol: ${parsed.protocol}`);
  }

  if (process.env.CLAWX_E2E === '1') {
    return;
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'jitclaw-topup-'));
  const filePath = join(tempDir, 'epay-redirect.html');
  await writeFile(filePath, buildAutoSubmitHtml(actionUrl, formParams), 'utf8');
  await shell.openExternal(pathToFileURL(filePath).toString());

  setTimeout(() => {
    void rm(tempDir, { recursive: true, force: true });
  }, 60_000);
}
