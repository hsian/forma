import type { PrototypeDocument } from './model';
import type { PageInfo, ProjectInfo } from './projects';

export interface OfflineVersion {
  format: 'forma-offline-version';
  formatVersion: 1;
  exportedAt: number;
  project: ProjectInfo;
  version: { id: string; name: string; description: string; createdAt: number };
  pages: PageInfo[];
  documents: Record<string, PrototypeDocument>;
  assets: Record<string, string>;
}

export function offlineDocument(snapshot: OfflineVersion, pageId: string) {
  const source = snapshot.documents[pageId];
  if (!source) throw Error('离线文件中没有此页面');
  const document = structuredClone(source);
  for (const element of document.elements) {
    const src = element.component?.src;
    if (typeof src === 'string' && src.startsWith('forma-offline-asset:')) {
      const value = snapshot.assets[src.slice('forma-offline-asset:'.length)];
      if (!value) throw Error('离线图片资源缺失');
      element.component!.src = value;
    }
  }
  return document;
}
