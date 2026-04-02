export interface ModelRefParts {
  providerKey: string;
  modelId: string;
}

function normalizeModelRefValue(modelRef: string | null | undefined): string {
  return (modelRef || '').trim();
}

export function splitModelRef(modelRef: string | null | undefined): ModelRefParts | null {
  const value = normalizeModelRefValue(modelRef);
  const separatorIndex = value.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) {
    return null;
  }

  return {
    providerKey: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 1),
  };
}

export function joinModelRef(providerKey: string, modelId: string): string {
  const normalizedProviderKey = providerKey.trim();
  const normalizedModelId = modelId.trim();
  if (!normalizedProviderKey || !normalizedModelId) {
    return '';
  }

  return `${normalizedProviderKey}/${normalizedModelId}`;
}

export function getModelIdForProvider(
  modelRef: string | null | undefined,
  providerKey: string,
): string {
  const parsedModelRef = splitModelRef(modelRef);
  if (!parsedModelRef || parsedModelRef.providerKey !== providerKey) {
    return '';
  }

  return parsedModelRef.modelId;
}
