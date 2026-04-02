import { describe, expect, it } from 'vitest';
import { resolveNewApiRuntimeBaseUrl } from '@electron/utils/new-api-config';

describe('resolveNewApiRuntimeBaseUrl', () => {
  it.each([
    ['appends /v1 for a bundled New API root URL', 'https://newapi.example.com', 'https://newapi.example.com/v1'],
    ['preserves an explicit /v1 base URL', 'https://newapi.example.com/v1', 'https://newapi.example.com/v1'],
    ['normalizes a chat completions endpoint back to its runtime base URL', 'https://newapi.example.com/v1/chat/completions', 'https://newapi.example.com/v1'],
  ])('%s', (_name, input, expected) => {
    expect(resolveNewApiRuntimeBaseUrl(input)).toBe(expected);
  });
});
