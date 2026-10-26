import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Spin } from 'antd';
import { authApi, useAuth } from './AuthGate';
import { ManagementCenter } from './ManagementCenter';
import type { ProjectRole } from '../shared/auth';

export interface ManagedProject { id: string; name: string; projectRole?: ProjectRole }
export function ManagementPage() {
  const { user, logout } = useAuth();
  const [projects, setProjects] = useState<ManagedProject[]>();
  const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  useEffect(() => {
    document.title = '管理中心 · forma';
    const controller = new AbortController();
    void authApi<{ projects: ManagedProject[] }>('/api/projects').then(result => {
      if (!controller.signal.aborted) setProjects(result.projects.filter(project => user.role === 'admin' || project.projectRole === 'admin'));
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [retry, user.role]);
  const requested = new URLSearchParams(window.location.search).get('projectId');
  const projectId = projects?.find(project => project.id === requested)?.id || projects?.[0]?.id || '';
  if (projects && (projects.length || user.role === 'admin')) return <ManagementCenter key={projectId} projectId={projectId} projects={projects}/>;
  return <main className="management-page management-unavailable"><div className="management-unavailable-card"><div className="auth-brand">forma</div><h1>管理中心</h1>{error ? <Alert type="error" showIcon message="无法读取管理中心" description={error} action={<Button onClick={() => { setError(''); setRetry(value => value + 1); }}>重试</Button>}/> : !projects ? <Spin tip="正在读取可管理的项目"><div style={{ minHeight: 80 }}/></Spin> : <Empty description="你目前没有项目管理权限，请联系项目管理员。"/>}<div className="management-unavailable-actions"><Button type="primary" onClick={() => window.location.assign('/')}>返回原型设计</Button><Button onClick={() => { void logout(); }}>退出登录</Button></div></div></main>;
}
