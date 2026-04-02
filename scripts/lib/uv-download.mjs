const DEFAULT_UV_VERSION = '0.10.0';
const DEFAULT_UV_DOWNLOAD_BASE_URL = 'https://mirrors.ustc.edu.cn/github-release/astral-sh/uv/LatestRelease';
const OFFICIAL_UV_DOWNLOAD_BASE_URL = `https://github.com/astral-sh/uv/releases/download/${DEFAULT_UV_VERSION}`;

function replaceTemplateTokens(value, version, filename = '') {
  return value
    .replaceAll('{version}', version)
    .replaceAll('{filename}', filename);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

/**
 * @param {string} version
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveUvDownloadBaseUrl(version = DEFAULT_UV_VERSION, env = process.env) {
  const configuredBaseUrl = firstNonEmpty(
    env.CLAWX_UV_DOWNLOAD_BASE_URL,
    env.UV_DOWNLOAD_BASE_URL,
  );

  if (!configuredBaseUrl) {
    return DEFAULT_UV_DOWNLOAD_BASE_URL;
  }

  return replaceTemplateTokens(configuredBaseUrl, version).replace(/\/+$/, '');
}

/**
 * @param {string} filename
 * @param {string} version
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveUvDownloadUrl(filename, version = DEFAULT_UV_VERSION, env = process.env) {
  const configuredTemplate = firstNonEmpty(
    env.CLAWX_UV_DOWNLOAD_URL_TEMPLATE,
    env.UV_DOWNLOAD_URL_TEMPLATE,
  );

  if (configuredTemplate) {
    return replaceTemplateTokens(configuredTemplate, version, filename);
  }

  const baseUrl = resolveUvDownloadBaseUrl(version, env);
  return `${baseUrl}/${filename}`;
}

/**
 * @param {string} filename
 * @param {string} version
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function resolveUvDownloadUrls(filename, version = DEFAULT_UV_VERSION, env = process.env) {
  const urls = [];
  const configuredTemplate = firstNonEmpty(
    env.CLAWX_UV_DOWNLOAD_URL_TEMPLATE,
    env.UV_DOWNLOAD_URL_TEMPLATE,
  );
  const configuredBaseUrl = firstNonEmpty(
    env.CLAWX_UV_DOWNLOAD_BASE_URL,
    env.UV_DOWNLOAD_BASE_URL,
  );

  if (configuredTemplate) {
    urls.push(replaceTemplateTokens(configuredTemplate, version, filename));
  } else if (configuredBaseUrl) {
    urls.push(`${replaceTemplateTokens(configuredBaseUrl, version).replace(/\/+$/, '')}/${filename}`);
  }

  urls.push(resolveUvDownloadUrl(filename, version, {}));
  urls.push(`${replaceTemplateTokens(OFFICIAL_UV_DOWNLOAD_BASE_URL, version)}/${filename}`);

  return [...new Set(urls)];
}
