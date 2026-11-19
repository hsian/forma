export interface ApplicationRuntimeStatus {
  state: 'stopped' | 'starting' | 'running' | 'error';
  available: boolean;
  instanceId: string | null;
  url: string | null;
  error: string | null;
  logs: string;
  directory: string | null;
  publishedRevision: number;
  syncError: string | null;
}
