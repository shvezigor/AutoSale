import { workspaceSearchResponseSchema, type WorkspaceSearchResponse } from '../../../../packages/contracts/src/search';

export class WorkspaceSearchApiError extends Error {
  constructor(public readonly status?: number, options?: ErrorOptions) {
    super('Workspace search failed', options);
    this.name = 'WorkspaceSearchApiError';
  }
}

export async function searchWorkspace(query: string, signal?: AbortSignal): Promise<WorkspaceSearchResponse> {
  const params = new URLSearchParams({ q: query, limit: '5' });
  const response = await fetch(`/api/search?${params.toString()}`, { cache: 'no-store', ...(signal ? { signal } : {}) });
  if (!response.ok) throw new WorkspaceSearchApiError(response.status);
  try {
    return workspaceSearchResponseSchema.parse(await response.json());
  } catch (error) {
    throw new WorkspaceSearchApiError(response.status, { cause: error });
  }
}
