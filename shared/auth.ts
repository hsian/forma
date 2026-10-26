export interface AuthUser { id: string; username: string; role: 'admin' | 'member'; enabled?: boolean; canCreateProject?: boolean; createdAt?: number }
export type ProjectRole = 'admin' | 'editor' | 'viewer';
export interface PageLease { owned: boolean; username?: string; expiresAt?: number }

export const permissionGroups = [
  { name: '原型页面', items: [{ id: 'prototype.read', label: '查看与预览' }, { id: 'prototype.edit', label: '编辑原型与 AI 编辑' }, { id: 'page.manage', label: '新建、重命名、移动和复制页面' }, { id: 'page.delete', label: '删除页面及子页面' }, { id: 'sketch.import', label: '导入 Sketch' }] },
  { name: '原型版本', items: [{ id: 'version.copy', label: '从版本创建项目' }, { id: 'version.publish', label: '确认固定版本' }, { id: 'version.delete', label: '删除固定版本' }] },
  { name: '项目设置', items: [{ id: 'project.update', label: '修改项目基本信息' }, { id: 'project.delete', label: '删除项目' }] },
  { name: '成员与角色', items: [{ id: 'member.manage', label: '管理成员与角色（仅项目管理员）' }] },
] as const;
export type Permission = typeof permissionGroups[number]['items'][number]['id'];
export const allPermissions: Permission[] = permissionGroups.flatMap(group => group.items.map(item => item.id));
export interface PermissionRole { id: string; name: string; description: string; permissions: Permission[]; builtin: boolean; revision?: number }
export const builtinRoles: PermissionRole[] = [
  { id: 'viewer', name: '只读成员', description: '查看原型、预览和历史版本', permissions: ['prototype.read'], builtin: true },
  { id: 'designer', name: '原型设计者', description: '设计与管理页面，不含页面删除和版本发布', permissions: ['prototype.read', 'prototype.edit', 'page.manage', 'sketch.import', 'version.copy'], builtin: true },
  { id: 'publisher', name: '版本负责人', description: '设计原型并确认固定版本', permissions: ['prototype.read', 'prototype.edit', 'page.manage', 'sketch.import', 'version.copy', 'version.publish'], builtin: true },
  { id: 'editor', name: '可编辑（兼容）', description: '保留现有编辑成员的全部权限，包括删除页面', permissions: ['prototype.read', 'prototype.edit', 'page.manage', 'page.delete', 'sketch.import', 'version.copy'], builtin: true },
  { id: 'admin', name: '项目管理员', description: '管理项目内容、成员和角色', permissions: allPermissions, builtin: true },
];
export const permissionLabel = (id: Permission) => permissionGroups.flatMap(group => [...group.items]).find(item => item.id === id)?.label || id;
