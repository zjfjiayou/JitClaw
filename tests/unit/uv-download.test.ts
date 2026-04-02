import { describe, expect, it } from 'vitest';
import { resolveUvDownloadBaseUrl, resolveUvDownloadUrl, resolveUvDownloadUrls } from '../../scripts/lib/uv-download.mjs';

describe('uv download URL resolution', () => {
  it('uses the USTC mirror URL by default', () => {
    expect(resolveUvDownloadBaseUrl('0.10.0', {} as NodeJS.ProcessEnv))
      .toBe('https://mirrors.ustc.edu.cn/github-release/astral-sh/uv/LatestRelease');
    expect(resolveUvDownloadUrl('uv-x86_64-apple-darwin.tar.gz', '0.10.0', {} as NodeJS.ProcessEnv))
      .toBe('https://mirrors.ustc.edu.cn/github-release/astral-sh/uv/LatestRelease/uv-x86_64-apple-darwin.tar.gz');
  });

  it('uses a custom base URL when configured', () => {
    const env = {
      CLAWX_UV_DOWNLOAD_BASE_URL: 'https://oss.example.com/artifacts/uv/{version}/',
    } as NodeJS.ProcessEnv;

    expect(resolveUvDownloadBaseUrl('0.10.0', env))
      .toBe('https://oss.example.com/artifacts/uv/0.10.0');
    expect(resolveUvDownloadUrl('uv-aarch64-apple-darwin.tar.gz', '0.10.0', env))
      .toBe('https://oss.example.com/artifacts/uv/0.10.0/uv-aarch64-apple-darwin.tar.gz');
  });

  it('prefers an explicit URL template when configured', () => {
    const env = {
      CLAWX_UV_DOWNLOAD_BASE_URL: 'https://ignored.example.com/uv/{version}',
      CLAWX_UV_DOWNLOAD_URL_TEMPLATE: 'https://cdn.example.com/uv/{version}/files/{filename}',
    } as NodeJS.ProcessEnv;

    expect(resolveUvDownloadUrl('uv-x86_64-unknown-linux-gnu.tar.gz', '0.10.0', env))
      .toBe('https://cdn.example.com/uv/0.10.0/files/uv-x86_64-unknown-linux-gnu.tar.gz');
  });

  it('prefers USTC mirror before GitHub when no override is configured', () => {
    expect(resolveUvDownloadUrls('uv-aarch64-apple-darwin.tar.gz', '0.10.0', {} as NodeJS.ProcessEnv)).toEqual([
      'https://mirrors.ustc.edu.cn/github-release/astral-sh/uv/LatestRelease/uv-aarch64-apple-darwin.tar.gz',
      'https://github.com/astral-sh/uv/releases/download/0.10.0/uv-aarch64-apple-darwin.tar.gz',
    ]);
  });
});
