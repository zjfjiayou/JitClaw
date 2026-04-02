import newApiModelCatalog from '../../resources/new-api-models.json';

export type NewApiModelInput = 'text' | 'image';

export interface NewApiModelCatalogEntry {
  id: string;
  name: string;
  description: string;
  input: readonly NewApiModelInput[];
}

export interface NewApiModelOption {
  id: string;
  name: string;
  description: string;
}

export const NEW_API_RUNTIME_PROVIDER_KEY = 'custom-newapi';
export const DEFAULT_NEW_API_MODEL_ID = 'gpt-5.4';

export const NEW_API_MODEL_CATALOG = newApiModelCatalog as readonly NewApiModelCatalogEntry[];

const NEW_API_MODEL_INDEX = new Map(
  NEW_API_MODEL_CATALOG.map((model) => [model.id, model]),
);

function normalizeModelId(modelId: string | null | undefined): string {
  return (modelId || '').trim();
}

export function getNewApiModelCatalogEntry(
  modelId: string | null | undefined,
): NewApiModelCatalogEntry | undefined {
  const normalizedModelId = normalizeModelId(modelId);
  if (!normalizedModelId) {
    return undefined;
  }

  return NEW_API_MODEL_INDEX.get(normalizedModelId);
}

export function isKnownNewApiModelId(modelId: string | null | undefined): boolean {
  return Boolean(getNewApiModelCatalogEntry(modelId));
}

export function resolveNewApiModelId(modelId: string | null | undefined): string {
  const normalizedModelId = normalizeModelId(modelId);
  return isKnownNewApiModelId(normalizedModelId)
    ? normalizedModelId
    : DEFAULT_NEW_API_MODEL_ID;
}

export function listNewApiModelOptions(): NewApiModelOption[] {
  return NEW_API_MODEL_CATALOG.map(({ id, name, description }) => ({
    id,
    name,
    description,
  }));
}
