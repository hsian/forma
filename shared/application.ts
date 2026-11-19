export const applicationTemplates = [
  { id: 'admin', name: '管理后台', version: '1.1.0', available: true, description: '分层工程、公共能力、独立接口适配与场景开发约定' },
] as const;

export interface ApplicationProject {
  templateId: 'admin';
  templateVersion: string;
  directoryName: string;
  directory: string;
  parentDirectory?: string;
  directorySelection?: 'native';
  createdAt: number;
  syncedAt: number;
}
export interface ApplicationSetup {
  rootDirectory: string;
  templates: typeof applicationTemplates;
}
export interface GeneratedPageSource { pageId: string; name: string; file: string; revision: number }
export interface ApplicationSyncStatus {
  state: 'pending' | 'synced' | 'error';
  revision: number;
  publishedRevision: number;
  attemptedAt: number | null;
  error: string | null;
  warning: string | null;
  sourceFiles: GeneratedPageSource[];
}
