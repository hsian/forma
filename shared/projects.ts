import type { ApplicationProject } from './application';
export interface ProjectInfo { id: string; name: string; createdAt: number; updatedAt: number; application?: ApplicationProject | null }
export interface PageInfo {
  id: string; projectId: string; parentId: string | null; folderId: string | null;
  name: string; position: number; createdAt: number; updatedAt: number;
  uiDesignRequired?: boolean;
  uiDesignCount?: number;
}
export interface DesignBoardInfo { id: string; pageId: string; name: string; createdAt: number }
