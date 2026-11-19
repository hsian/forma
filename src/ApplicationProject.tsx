import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Input, Modal, Spin, Tooltip, Typography } from 'antd';
import { CheckCircleFilled, FolderOpenOutlined, LoadingOutlined, WarningOutlined } from '@ant-design/icons';
import type { ApplicationProject, ApplicationSetup, ApplicationSyncStatus } from '../shared/application';
import './application-project.css';

export interface ApplicationCreation { templateId: 'admin'; parentDirectory?: string; directoryToken?: string }
const adminPreview = new URL('./assets/admin-template.svg', import.meta.url).href;
async function api<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw Error(data.message || '无法读取工程配置');
  return data;
}
export function ApplicationProjectFields({ value, onChange, onReady }: { value: ApplicationCreation; onChange: (value: ApplicationCreation) => void; onReady: (ready: boolean) => void }) {
  const [setup, setSetup] = useState<ApplicationSetup>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [selectingDirectory, setSelectingDirectory] = useState(false);
  const [directoryError, setDirectoryError] = useState('');
  const directoryRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { directoryRequest.current?.abort(); directoryRequest.current = null; }, []);
  async function chooseDirectory() {
    if (directoryRequest.current) return;
    const controller = new AbortController();
    directoryRequest.current = controller;
    setSelectingDirectory(true); setDirectoryError(''); onReady(false);
    try {
      const response = await fetch('/api/application-directories/pick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initialDirectory: value.parentDirectory || setup?.rootDirectory }), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw Error(result.message || '无法打开系统目录选择窗口');
      if (result.directory && !controller.signal.aborted) onChange({ ...value, parentDirectory: result.directory, directoryToken: result.directoryToken });
    } catch (error) { if (!controller.signal.aborted) setDirectoryError((error as Error).message); }
    finally { if (!controller.signal.aborted) { directoryRequest.current = null; setSelectingDirectory(false); onReady(true); } }
  }
  useEffect(() => {
    let live = true;
    onReady(false); setError('');
    void api<ApplicationSetup>('/api/application-templates').then(data => { if (live) { setSetup(data); onReady(true); } }).catch(error => { if (live) setError(error.message); });
    return () => { live = false; };
  }, [attempt, onReady]);
  if (error) return <Alert type="error" message={error} action={<Button size="small" onClick={() => setAttempt(value => value + 1)}>重试</Button>}/>;
  if (!setup) return <Spin tip="读取项目模板"/>;
  return <div className="application-fields">
    <label className="stacked-label">项目模板</label>
    <div className="application-template-grid" role="radiogroup" aria-label="项目模板">
      {setup.templates.map(template => <button type="button" role="radio" aria-checked={value.templateId === template.id} aria-label={template.name} key={template.id} className={`application-template-card ${value.templateId === template.id ? 'is-selected' : ''}`} onClick={() => onChange({ ...value, templateId: template.id })}>
        <img src={adminPreview} alt="管理后台模板预览"/>
        <span className="application-template-caption"><span><strong>{template.name}</strong><span>{template.description}</span></span>{value.templateId === template.id && <CheckCircleFilled className="application-template-check"/>}</span>
      </button>)}
    </div>
    <label className="stacked-label" htmlFor="application-parent-directory">存放位置</label>
    <div className="application-directory-field"><Input id="application-parent-directory" className="application-project-input" aria-label="存放位置" readOnly value={value.parentDirectory || setup.rootDirectory} onClick={() => { void chooseDirectory(); }}/><Button aria-label="选择目录" icon={<FolderOpenOutlined/>} loading={selectingDirectory} onClick={() => { void chooseDirectory(); }}>选择目录</Button></div>
    <Typography.Paragraph type="secondary" className="application-directory-help">点击打开 Windows 文件夹选择窗口，选定后自动填入路径。项目会在所选目录内创建独立文件夹。</Typography.Paragraph>
    {directoryError && <Alert type="error" showIcon message={directoryError} style={{ marginBottom: 16 }}/>}
    <Alert type="info" showIcon message="自动初始化独立前端工程" description="页面保存后自动生成对应的 React 页面文件与路由，包含统一 request 和开发者扩展目录；真实接口绑定将在后续阶段接入。"/>
  </div>;
}

export function ApplicationSyncIndicator({ projectId, onInspect }: { projectId: string; onInspect: () => void }) {
  const [sync, setSync] = useState<ApplicationSyncStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let live = true; setSync(null); setUnavailable(false);
    async function load() {
      try { const result = await api<{ application: ApplicationProject | null; sync: ApplicationSyncStatus | null }>(`/api/projects/${encodeURIComponent(projectId)}/application`); if (live) { setSync(result.application ? result.sync : null); setUnavailable(false); } }
      catch { if (live) setUnavailable(true); }
    }
    if (projectId) void load();
    const interval = setInterval(() => { if (projectId) void load(); }, 2000);
    return () => { live = false; clearInterval(interval); };
  }, [projectId]);
  if (!sync && !unavailable) return null;
  const state = unavailable ? 'error' : sync!.state;
  const label = unavailable ? '无法读取工程状态' : state === 'error' ? '工程同步失败' : state === 'pending' ? '正在生成页面源码' : '页面源码已同步';
  return <Tooltip title={unavailable ? '点击查看工程状态' : sync?.error || sync?.warning || `已生成 ${sync?.sourceFiles.length || 0} 个 React 页面文件；保存后自动更新`}><button className={`application-sync-indicator ${state}`} type="button" aria-label="查看工程同步状态" onClick={onInspect}>{state === 'error' ? <WarningOutlined/> : state === 'pending' ? <LoadingOutlined/> : <CheckCircleFilled/>}<span>{label}</span></button></Tooltip>;
}

export function ApplicationProjectPanel({ projectId, canSync, busy, onCancel, onSync }: { projectId: string; canSync: boolean; busy: boolean; onCancel: () => void; onSync: () => Promise<boolean> }) {
  const [application, setApplication] = useState<ApplicationProject | null>();
  const [sync, setSync] = useState<ApplicationSyncStatus | null>(null);
  const [error, setError] = useState('');
  async function load() { const result = await api<{ application: ApplicationProject | null; sync: ApplicationSyncStatus | null }>(`/api/projects/${encodeURIComponent(projectId)}/application`); setApplication(result.application); setSync(result.sync); setError(''); }
  useEffect(() => { let live = true; async function refresh() { try { const result = await api<{ application: ApplicationProject | null; sync: ApplicationSyncStatus | null }>(`/api/projects/${encodeURIComponent(projectId)}/application`); if (live) { setApplication(result.application); setSync(result.sync); setError(''); } } catch (error) { if (live) setError((error as Error).message); } } void refresh(); const interval = setInterval(() => { void refresh(); }, 2000); return () => { live = false; clearInterval(interval); }; }, [projectId]);
  return <Modal open title="业务工程" width={640} onCancel={() => { if (!busy) onCancel(); }} footer={<><Button disabled={busy} onClick={onCancel}>关闭</Button><Button type="primary" disabled={!application || !canSync} loading={busy} onClick={() => { void (async () => { if (await onSync()) await load(); })().catch(error => setError(error.message)); }}>同步页面到工程</Button></>}>
    {error ? <Alert type="error" message={error}/> : application === undefined ? <Spin/> : application === null ? <Alert type="info" message="这是已有的纯原型项目" description="新建项目并选择模板，即可自动初始化独立的业务工程。已有原型和版本继续保留。"/> : <>
      <Descriptions column={1} size="small" items={[
        { key: 'template', label: '项目模板', children: `管理后台 · ${application.templateVersion}` },
        { key: 'directory', label: '服务器目录', children: <Typography.Text copyable style={{ overflowWrap: 'anywhere' }}>{application.directory}</Typography.Text> },
        { key: 'sync', label: '上次同步', children: new Date(application.syncedAt).toLocaleString() },
        { key: 'status', label: '自动生成', children: sync?.state === 'error' ? '同步失败，页面仍已保存在 Forma' : sync?.state === 'synced' ? '页面源码已同步' : '等待生成页面源码' },
      ]}/>
      {sync?.error && <Alert type="error" showIcon message="页面已保存，工程生成失败" description={sync.error} style={{ marginTop: 16 }}/>}
      {sync?.warning && <Alert type="warning" showIcon message={sync.warning} style={{ marginTop: 16 }}/>}
      {!!sync?.sourceFiles.length && <div className="application-source-files"><strong>已生成的页面文件</strong>{sync.sourceFiles.map(source => <div key={source.pageId}><span>{source.name}</span><Typography.Text code copyable>{source.file}</Typography.Text></div>)}</div>}
      <Typography.Paragraph style={{ marginTop: 20 }}>维护者在工程目录执行 <Typography.Text code>npm install</Typography.Text>，然后执行 <Typography.Text code>npm run dev</Typography.Text> 运行应用，执行 <Typography.Text code>npm run build</Typography.Text> 构建。</Typography.Paragraph>
      <Alert type="info" showIcon message="保存后自动生成页面文件与路由" description="源码位于 src/pages/generated，每页独立一个 .tsx 文件，多个页面共用运行组件。保留开发者维护的配置、公共组件、函数和接口代码；手改生成文件会提示冲突。当前仍使用原型布局和模拟交互。"/>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>模板运行器固定版本；删除 Forma 项目保留工程文件。原型版本不包含源码，请单独管理工程版本和备份。</Typography.Paragraph>
    </>}
  </Modal>;
}
