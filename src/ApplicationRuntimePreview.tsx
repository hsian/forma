import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Alert, Button, Empty, Modal, Spin, Tooltip, Typography } from 'antd';
import { EditOutlined, EyeOutlined, PlayCircleOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import type { ApplicationRuntimeStatus } from '../shared/application-runtime';
import './application-runtime.css';

export async function runtimeApi(projectId: string, action?: 'start' | 'stop') {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/runtime${action ? `/${action}` : ''}`, { method: action ? 'POST' : 'GET' });
  const result = await response.json();
  if (!response.ok) throw Error(result.message || '无法读取开发预览状态');
  return result as ApplicationRuntimeStatus;
}

export function ApplicationRuntimePreview({ projectId, pageId, canManage, toolbarTarget, inspecting, onInspect, selectedId, elementIds, onSelect }: { projectId: string; pageId: string; canManage: boolean; toolbarTarget: HTMLElement | null; inspecting: boolean; onInspect: (value: boolean) => void; selectedId?: string; elementIds: string[]; onSelect: (id: string | null) => void }) {
  const [status, setStatus] = useState<ApplicationRuntimeStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [frameError, setFrameError] = useState('');
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const live = useRef(true);
  const operation = useRef(false);
  const operationEpoch = useRef(0);
  const iframe = useRef<HTMLIFrameElement>(null);
  const bridge = useRef({ inspecting, selectedId, elementIds, pageId, onSelect });
  bridge.current = { inspecting, selectedId, elementIds, pageId, onSelect };
  function sendInspection() {
    const state = bridge.current;
    iframe.current?.contentWindow?.postMessage({ type: 'forma:inspect-state', enabled: state.inspecting, selectedId: state.selectedId, ids: state.elementIds }, window.location.origin);
  }
  useEffect(sendInspection, [inspecting, selectedId, elementIds, loaded, pageId]);
  async function act(action: 'start' | 'stop') {
    if (operation.current) return;
    operation.current = true; operationEpoch.current++; setBusy(true); setError('');
    try { const result = await runtimeApi(projectId, action); if (live.current) setStatus(result); }
    catch (error) { if (live.current) { setError((error as Error).message); try { setStatus(await runtimeApi(projectId)); } catch {} } }
    finally { operation.current = false; if (live.current) setBusy(false); }
  }
  useEffect(() => {
    live.current = true;
    void (async () => {
      try {
        const initial = await runtimeApi(projectId);
        if (!live.current) return;
        setStatus(initial);
        if (initial.available && initial.state !== 'running' && canManage) await act('start');
      } catch (error) { if (live.current) setError((error as Error).message); }
    })();
    let polling = false;
    const interval = setInterval(() => { if (polling || operation.current) return; polling = true; const epoch = operationEpoch.current; void runtimeApi(projectId).then(result => { if (live.current && epoch === operationEpoch.current) { setStatus(result); if (result.state === 'running') setError(''); } }).catch(error => { if (live.current && epoch === operationEpoch.current) setError(error.message); }).finally(() => { polling = false; }); }, 2000);
    return () => { live.current = false; clearInterval(interval); };
  }, [projectId]);
  const frameKey = `${status?.instanceId}:${status?.publishedRevision}:${refresh}`;
  useEffect(() => { setLoaded(false); }, [frameKey]);
  useEffect(() => { setFrameError(''); }, [frameKey, pageId]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframe.current?.contentWindow) return;
      if (event.data?.type === 'forma:runtime-error' && typeof event.data.message === 'string') setFrameError(event.data.message.slice(0, 3000));
      if (event.data?.type === 'forma:inspect-ready') sendInspection();
      const state = bridge.current;
      if (event.data?.type === 'forma:inspect-select' && state.inspecting && event.data.pageId === state.pageId && (event.data.id === null || typeof event.data.id === 'string' && state.elementIds.includes(event.data.id))) state.onSelect(event.data.id);
    };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, []);
  const running = status?.state === 'running' && !!status.url;
  const starting = status?.state === 'starting' || busy && !running;
  return <div className="application-runtime-preview" data-runtime-state={status?.state || 'loading'}>
    {toolbarTarget && createPortal(<>
      <span className="application-runtime-state" role="status">{running ? <><i className="green-dot"/>真实工程运行中</> : starting ? '正在启动业务工程…' : status?.state === 'error' ? '业务工程启动失败' : status?.state === 'stopped' ? '真实预览已停止' : '正在读取开发预览…'}</span>
      <div className="canvas-ruler-actions" role="group" aria-label="真实页面操作模式">{running && <>
      <Button className="annotation-toolbar-button" type="text" size="small" title="点击组件，在右侧修改属性" aria-label="编辑模式" icon={<EditOutlined/>} aria-pressed={inspecting} onClick={() => onInspect(true)}>编辑</Button>
      <Button className="annotation-toolbar-button" type="text" size="small" title="正常操作按钮和表单，体验页面交互" aria-label="交互预览" icon={<EyeOutlined/>} aria-pressed={!inspecting} onClick={() => onInspect(false)}>预览</Button>
      <Tooltip title="刷新真实预览"><Button type="text" size="small" aria-label="刷新真实预览" icon={<ReloadOutlined/>} onClick={() => setRefresh(value => value + 1)}/></Tooltip>
      {canManage && <Tooltip title="停止真实预览"><Button type="text" size="small" aria-label="停止真实预览" disabled={busy} icon={<StopOutlined/>} onClick={() => { void act('stop'); }}/></Tooltip>}
      </>}</div>
    </>, toolbarTarget)}
    {(error || status?.error) && <Alert type="error" showIcon message={error || status?.error}/>}
    {status?.syncError && <Alert type="warning" showIcon message="页面已保存，工程尚未同步" description={status.syncError}/>}
    {frameError && <Alert type="error" showIcon message="页面运行出错" description={frameError}/>}
    {running ? <div className="application-runtime-frame-wrap">{!loaded && <div className="application-runtime-loading"><Spin tip="加载真实页面"/></div>}<iframe ref={iframe} key={frameKey} title="真实工程预览" src={`${status.url}#${new URLSearchParams({ page: pageId })}`} sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-downloads" onLoad={() => setLoaded(true)}/></div> : <div className="application-runtime-empty">
      {starting || !status && !error ? <Spin tip="正在读取开发预览"/> : <><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={status?.available === false ? '当前项目是纯原型，尚未关联业务工程' : status?.state === 'error' ? '业务工程暂未能运行' : '开发预览已停止'}/>{status?.available && canManage && <Button type="primary" aria-label="启动真实预览" icon={<PlayCircleOutlined/>} loading={busy} onClick={() => { void act('start'); }}>启动 / 重试</Button>}{status?.available && !canManage && <Typography.Paragraph type="secondary">请项目维护者启动开发预览，启动后此处会自动显示。</Typography.Paragraph>}{status?.directory && <Typography.Paragraph type="secondary" className="application-runtime-directory">工程位置：<Typography.Text copyable>{status.directory}</Typography.Text></Typography.Paragraph>}</>}
    </div>}
    <section className={`application-runtime-logs ${logsOpen ? 'open' : ''}`} aria-label="运行日志面板">
      <div className="application-runtime-logs-heading"><button type="button" aria-expanded={logsOpen} aria-controls="runtime-log-output" onClick={() => setLogsOpen(value => !value)}>{logsOpen ? '▾' : '▸'} 运行日志</button>{logsOpen && <Button size="small" type="text" onClick={() => setLogsExpanded(true)}>放大查看</Button>}</div>
      {logsOpen && <pre id="runtime-log-output" tabIndex={0}>{status?.logs || '暂无运行日志'}</pre>}
    </section>
    <Modal title="运行日志" open={logsExpanded} onCancel={() => setLogsExpanded(false)} footer={null} width="80vw"><pre className="application-runtime-logs-expanded" tabIndex={0}>{status?.logs || '暂无运行日志'}</pre></Modal>
  </div>;
}
