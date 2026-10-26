import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Alert, App, Button, Dropdown, Form, Input, Spin } from 'antd';
import type { AuthUser, ProjectRole } from '../shared/auth';
import './auth.css';

export async function authApi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw Error(value.message || '操作失败');
  return value;
}
const Context = createContext<{ user: AuthUser; logout: () => Promise<void> } | null>(null);
export function useAuth() { const value = useContext(Context); if (!value) throw Error('请先登录'); return value; }
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ setupRequired: boolean; user: AuthUser | null }>();
  const [hasProject, setHasProject] = useState(false);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function refresh() {
    const result = await authApi<{ setupRequired: boolean; user: AuthUser | null }>('/api/auth/status');
    if (result.user) { const { projects } = await authApi<{ projects: unknown[] }>('/api/projects'); setHasProject(!!projects.length); }
    setState(result); setError('');
  }
  useEffect(() => {
    void refresh().catch(error => setError(error.message));
    const unauthorized = () => { setState(old => old ? { ...old, user: null } : undefined); setHasProject(false); };
    window.addEventListener('forma:unauthorized', unauthorized); return () => window.removeEventListener('forma:unauthorized', unauthorized);
  }, []);
  async function submit(values: { username: string; password: string }) {
    setBusy(true); setError('');
    try { await authApi(state?.setupRequired ? '/api/auth/setup' : '/api/auth/login', 'POST', values); await refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : '登录失败'); if (state?.setupRequired) { const latest = await authApi<{ setupRequired: boolean; user: AuthUser | null }>('/api/auth/status'); setState(latest); } }
    finally { setBusy(false); }
  }
  async function logout() { await authApi('/api/auth/logout', 'POST'); setState({ setupRequired: false, user: null }); setHasProject(false); }
  if (state?.user && (hasProject || window.location.pathname === '/manage')) return <Context.Provider value={{ user: state.user, logout }}>{children}</Context.Provider>;
  return <main className="auth-screen"><section className="auth-card"><div className="auth-brand">forma</div>{!state ? <>{error ? <><Alert type="error" message={error}/><Button onClick={() => { void refresh().catch(error => setError(error.message)); }}>重新连接</Button></> : <Spin tip="正在连接"/>}</> : state.user ? <>
    <h1>还没有可访问的项目</h1><p>{state.user.role === 'admin' || state.user.canCreateProject ? '你可以创建自己的项目，或请管理员添加项目权限。' : '请联系项目管理员添加项目访问权限。'}</p><Form disabled={state.user.role !== 'admin' && !state.user.canCreateProject} onFinish={async values => { setBusy(true); try { await authApi('/api/projects', 'POST', { name: values.name }); await refresh(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } }}><Form.Item name="name" rules={[{ required: true, message: '请输入项目名称' }]}><Input aria-label="项目名称" placeholder="项目名称" maxLength={120}/></Form.Item><Button block type="primary" htmlType="submit" loading={busy}>创建项目</Button></Form><Button onClick={() => { void refresh(); }}>刷新权限</Button><Button onClick={() => { void logout(); }}>退出登录</Button>
  </> : <>
    <h1>{state.setupRequired ? '创建管理员账号' : '登录工作台'}</h1><p>{state.setupRequired ? '第一个账号自动成为管理员，并接管现有项目。后续账号由管理员创建。' : '登录后继续编辑和协作。'}</p>
    <Form layout="vertical" onFinish={submit} requiredMark={false}>
      <Form.Item label="用户名" name="username" rules={[{ required: true, message: '请输入用户名' }, { min: 2, max: 32, message: '用户名为 2–32 位' }]}><Input aria-label="用户名" autoComplete="username" maxLength={32}/></Form.Item>
      <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }, { min: 8, max: 128, message: '密码为 8–128 位' }]}><Input.Password aria-label="密码" autoComplete={state.setupRequired ? 'new-password' : 'current-password'} maxLength={128}/></Form.Item>
      {state.setupRequired && <Form.Item label="确认密码" name="confirm" dependencies={['password']} rules={[{ required: true, message: '请再次输入密码' }, ({ getFieldValue }) => ({ validator: (_, value) => !value || value === getFieldValue('password') ? Promise.resolve() : Promise.reject(Error('两次密码不一致')) })]}><Input.Password aria-label="确认密码" autoComplete="new-password"/></Form.Item>}
      <Button block type="primary" htmlType="submit" loading={busy}>{state.setupRequired ? '创建管理员并进入' : '登录'}</Button>
    </Form>
  </>}{error && state && <Alert role="alert" type="error" showIcon message={error}/>}</section></main>;
}

export function AccountMenu({ projectId, projectRole, flush }: { projectId: string; projectRole?: ProjectRole; flush: () => Promise<boolean> }) {
  const { user, logout } = useAuth(); const { message } = App.useApp();
  const manage = user.role === 'admin' || projectRole === 'admin';
  return <><Dropdown trigger={['click']} menu={{ items: [{ key: 'identity', label: `${user.username} · ${user.role === 'admin' ? '系统管理员' : '成员'}`, disabled: true }, ...(manage ? [{ key: 'members', label: '账号与项目权限' }] : []), { key: 'logout', label: '退出登录' }], onClick: ({ key }) => {
    if (key === 'members') void flush().then(saved => { if (saved) window.location.assign(`/manage?${new URLSearchParams({ projectId })}`); else void message.warning('请先保存或处理当前页面的修改'); });
    if (key === 'logout') void flush().then(async saved => { if (saved) await logout(); else void message.warning('请先保存或处理当前页面的修改'); });
  } }}><Button className="account-menu" aria-label="账号菜单" title={user.username}>{user.username.slice(0, 2).toUpperCase()}</Button></Dropdown>
  </>;
}
