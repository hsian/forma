export interface AuthUser { id: string; username: string; role: 'admin' | 'member' }
export type ProjectRole = 'admin' | 'editor' | 'viewer';
export interface PageLease { owned: boolean; username?: string; expiresAt?: number }
