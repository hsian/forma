import {ImportReport} from './ImportReport';
import type {PrototypeDocument} from '../shared/model';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { App, Button, Dropdown, Input, Modal, Select, Spin, Tree, type MenuProps } from 'antd';
import { FileOutlined, MoreOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { DataNode } from 'antd/es/tree';
import type { ProjectInfo, PageInfo } from '../shared/projects';
import { SketchImport } from './SketchImport';
import type { SketchBoard } from './SketchImport';
import type { DocumentSession } from './useDocumentSession';

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw Error(result.message || '操作失败，请重试');
  return result;
}
function descendants(id: string, pages: PageInfo[]) {
  const ids = new Set([id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const page of pages) if (page.parentId && ids.has(page.parentId) && !ids.has(page.id)) { ids.add(page.id); changed = true; }
  }
  return ids;
}
type NameRequest = { kind: 'new-project' | 'rename-project' | 'new-page' | 'rename-page'; targetId?: string; parentId?: string | null };
interface Manager {
  projects: ProjectInfo[]; pages: PageInfo[]; busy: boolean; session: DocumentSession;
  name: (request: NameRequest, value?: string) => void;
  selectProject: (id: string) => void; selectPage: (id: string) => void;
  projectAction: (key: string) => void; pageAction: (key: string, page: PageInfo) => void;
  refresh: () => void;
}
const Context = createContext<Manager | null>(null);
function useManager() { const manager = useContext(Context); if (!manager) throw Error('ProjectManagerProvider missing'); return manager; }

export function ProjectManagerProvider({ session, children, onBusyChange }: { session: DocumentSession; children: ReactNode; onBusyChange: (busy: boolean) => void }) {
  const { message, modal } = App.useApp();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const refreshGeneration = useRef(0);
  const [nameRequest, setNameRequest] = useState<NameRequest | null>(null);
  const [nameValue, setNameValue] = useState('');
  const [sketchOpen, setSketchOpen] = useState(false);
  const [movePage, setMovePage] = useState<PageInfo | null>(null);
  const [moveParent, setMoveParent] = useState('__root__');
  async function refresh(projectId = session.currentProjectId) {
    const generation = ++refreshGeneration.current;
    const [projectList, pageList] = await Promise.all([
      api<{ projects: ProjectInfo[] }>('/api/projects'),
      projectId ? api<{ pages: PageInfo[] }>(`/api/projects/${encodeURIComponent(projectId)}/pages`) : Promise.resolve({ pages: [] }),
    ]);
    if (generation !== refreshGeneration.current) return;
    setProjects(projectList.projects); setPages(pageList.pages);
  }
  useEffect(() => {
    if (!session.currentProjectId) return;
    let cancelled = false;
    void refresh().catch(error => { if (!cancelled) void message.error(error.message); });
    return () => { cancelled = true; };
  }, [session.currentProjectId]);
  async function run(operation: () => Promise<void>) {
    if (busyRef.current || session.server !== 'ready') return false;
    busyRef.current = true; setBusy(true); onBusyChange(true);
    try {
      if (!await session.flush()) throw Error('当前页面尚未保存，请先处理保存失败或版本冲突');
      await operation(); return true;
    } catch (error) { void message.error(error instanceof Error ? error.message : '操作失败'); return false; }
    finally { busyRef.current = false; setBusy(false); onBusyChange(false); }
  }
  async function openPage(id: string) { if (!await session.switchPage(id)) throw Error('页面未能切换，请先确认当前修改已经保存'); }
  function requestName(request: NameRequest, value = '') { if (request.kind === 'new-project' ? !session.canCreateProject : !session.can(request.kind === 'rename-project' ? 'project.update' : 'page.manage')) return; setNameRequest(request); setNameValue(value); }
  async function submitName() {
    const value = nameValue.trim();
    if (!value || !nameRequest) { void message.warning('请输入名称'); return; }
    const request = nameRequest;
    const success = await run(async () => {
      if (request.kind === 'new-project') {
        const created = await api<{ project: ProjectInfo; page: PageInfo }>('/api/projects', 'POST', { name: value });
        await openPage(created.page.id); await refresh(created.project.id);
      } else if (request.kind === 'rename-project') {
        await api(`/api/projects/${encodeURIComponent(request.targetId!)}`, 'PATCH', { name: value });
        await refresh(); await session.refreshMetadata();
      } else if (request.kind === 'new-page') {
        const created = await api<PageInfo>(`/api/projects/${encodeURIComponent(session.currentProjectId)}/pages`, 'POST', { name: value, parentId: request.parentId || null });
        await openPage(created.id); await refresh();
      } else {
        await api(`/api/pages/${encodeURIComponent(request.targetId!)}`, 'PATCH', { name: value });
        await refresh(); await session.refreshMetadata();
      }
    });
    if (success) setNameRequest(null);
  }
  async function importSketch(token: string, board: SketchBoard, acceptWarnings:boolean) {
    return run(async () => {
      const result=await api<{page:PageInfo;report:{elements:number;warnings:{message:string;count:number}[]}}>(`/api/projects/${encodeURIComponent(session.currentProjectId)}/sketch/${encodeURIComponent(token)}/import`,'POST',{pageId:board.pageId,boardId:board.boardId,acceptWarnings});
      setSketchOpen(false);
      await refresh();
      void message.success(`已生成新页面「${result.page.name}」，共 ${result.report.elements} 个元素${result.report.warnings.length ? '，部分设计效果已简化' : ''}`);
      await openPage(result.page.id);
    });
  }
  function projectAction(key: string) {
    if (key === 'sketch' && session.can('sketch.import')) setSketchOpen(true);
    if (key === 'rename') requestName({ kind: 'rename-project', targetId: session.currentProjectId }, session.projectName);
    if (key === 'delete') modal.confirm({
      title: `删除项目「${session.projectName}」？`, content: '项目内的所有页面、子页面和原型内容都会删除。', okText: '删除项目', cancelText: '取消', okButtonProps: { danger: true },
      onOk: () => run(async () => {
        const result = await api<{ fallbackPageId: string }>(`/api/projects/${encodeURIComponent(session.currentProjectId)}`, 'DELETE');
        await openPage(result.fallbackPageId);
      }),
    });
  }
  function pageAction(key: string, page: PageInfo) {
    if(key==='import-report')void run(async()=>{
      const result=await api<{document:PrototypeDocument}>(`/api/pages/${encodeURIComponent(page.id)}/document`);
      modal.info({title:'页面导入报告',width:640,content:result.document.importInfo?<ImportReport report={result.document.importInfo.report}/>:<p>此页面没有导入报告记录。</p>});
    });
    if (key === 'child') requestName({ kind: 'new-page', parentId: page.id });
    if (key === 'rename') requestName({ kind: 'rename-page', targetId: page.id }, page.name);
    if (key === 'move') { setMovePage(page); setMoveParent(page.parentId || '__root__'); }
    if (key === 'duplicate') void run(async () => {
      const copy = await api<PageInfo>(`/api/pages/${encodeURIComponent(page.id)}/duplicate`, 'POST');
      await openPage(copy.id); await refresh();
    });
    if (key === 'up' || key === 'down') void run(async () => { await api(`/api/pages/${encodeURIComponent(page.id)}`, 'PATCH', { order: key }); await refresh(); });
    if (key === 'delete') {
      const count = descendants(page.id, pages).size;
      modal.confirm({ title: `删除页面「${page.name}」？`, content: count > 1 ? `这会同时删除它的 ${count - 1} 个子页面及各自的原型内容。` : '此页面的原型内容也会删除。', okText: '删除页面', cancelText: '取消', okButtonProps: { danger: true },
        onOk: () => run(async () => {
          const result = await api<{ deletedIds: string[]; fallbackPageId: string }>(`/api/pages/${encodeURIComponent(page.id)}`, 'DELETE');
          if (result.deletedIds.includes(session.currentPageId)) await openPage(result.fallbackPageId);
          await refresh();
        }),
      });
    }
  }
  const blockedParents = movePage ? descendants(movePage.id, pages) : new Set<string>();
  function pagePath(page: PageInfo): string {
    const parent = page.parentId ? pages.find(item => item.id === page.parentId) : null;
    return parent ? `${pagePath(parent)} / ${page.name}` : page.name;
  }
  return <Context.Provider value={{ projects, pages, busy, session, name: requestName, projectAction, pageAction,
    selectProject: id => { if (id === session.currentProjectId) return; void run(async () => { const list = await api<{ pages: PageInfo[] }>(`/api/projects/${encodeURIComponent(id)}/pages`); const first = list.pages.find(page => !page.parentId) || list.pages[0]; if (!first) throw Error('项目没有页面'); await openPage(first.id); }); },
    selectPage: id => { void run(() => openPage(id)); },
    refresh: () => { void run(() => refresh()); },
  }}>{children}
    {sketchOpen && <SketchImport key={session.currentProjectId} projectId={session.currentProjectId} busy={busy} onCancel={()=>setSketchOpen(false)} onImport={importSketch}/>}
    <Modal open={!!nameRequest} title={nameRequest?.kind === 'new-project' ? '新建项目' : nameRequest?.kind === 'rename-project' ? '重命名项目' : nameRequest?.kind === 'new-page' ? nameRequest.parentId ? '新建子页面' : '新建页面' : '重命名页面'} okText="确定" cancelText="取消" confirmLoading={busy} onOk={() => { void submitName(); }} onCancel={() => { if (!busy) setNameRequest(null); }} destroyOnHidden>
      <label className="stacked-label">{nameRequest?.kind.includes('project') ? '项目名称' : '页面名称'}<Input autoFocus aria-label="管理名称" maxLength={120} placeholder="输入名称" value={nameValue} onChange={event => setNameValue(event.target.value)} onPressEnter={() => { void submitName(); }}/></label>
    </Modal>
    <Modal open={!!movePage} title={`移动页面「${movePage?.name || ''}」`} okText="移动" cancelText="取消" confirmLoading={busy} onCancel={() => { if (!busy) setMovePage(null); }} onOk={() => { if (!movePage) return; void run(async () => {
      await api(`/api/pages/${encodeURIComponent(movePage.id)}`, 'PATCH', { parentId: moveParent === '__root__' ? null : moveParent });
      await refresh(); setMovePage(null);
    }); }}>
      <label className="stacked-label">放置位置<Select aria-label="父页面" value={moveParent} onChange={setMoveParent} virtual={false} options={[{ value: '__root__', label: '项目根目录' }, ...pages.filter(page => !blockedParents.has(page.id)).map(page => ({ value: page.id, label: pagePath(page) }))]}/></label>
    </Modal>
  </Context.Provider>;
}

function ProjectSwitcher() {
  const { projects, busy, session, selectProject, projectAction, name } = useManager();
  const disabled = busy || session.server !== 'ready';
  return <div className="project-switcher"><Select aria-label="当前项目" variant="borderless" showSearch optionFilterProp="label" disabled={disabled} value={session.currentProjectId || undefined} placeholder={session.projectName}
    options={projects.length ? projects.map(project => ({ value: project.id, label: project.name })) : session.currentProjectId ? [{ value: session.currentProjectId, label: session.projectName }] : []} onChange={selectProject}/>
    <Dropdown trigger={['click']} menu={{ items: [{ key: 'sketch', label: '导入 Sketch', disabled: !session.can('sketch.import') }, { type: 'divider' }, { key: 'rename', label: '重命名项目', disabled: !session.can('project.update') }, { key: 'delete', label: '删除项目', danger: true, disabled: projects.length < 2 || !session.can('project.delete') }], onClick: info => projectAction(info.key) }}><button aria-label="项目操作" title="项目操作" disabled={disabled}><MoreOutlined/></button></Dropdown>
    <button aria-label="新建项目" title="新建项目" disabled={disabled || !session.canCreateProject} onClick={() => name({ kind: 'new-project' })}><PlusOutlined/></button>
  </div>;
}

export function PageTree() {
  const { pages, busy, session, name, pageAction, selectPage, refresh } = useManager();
  const [expanded, setExpanded] = useState<React.Key[]>([]);
  useEffect(() => {
    const parents: string[] = [];
    let current = pages.find(page => page.id === session.currentPageId);
    while (current?.parentId) { parents.push(current.parentId); current = pages.find(page => page.id === current!.parentId); }
    setExpanded(previous => [...new Set([...previous, ...parents])]);
  }, [pages, session.currentPageId]);
  function nodes(parentId: string | null): DataNode[] {
    return pages.filter(page => page.parentId === parentId).map(page => ({ key: page.id, icon: <FileOutlined/>, title: <span className="page-tree-title"><span title={page.name}>{page.name}</span><Dropdown trigger={['click']} menu={{ items: ([
      { key:'import-report',label:'查看导入报告' }, { type:'divider' }, { key: 'child', label: '新建子页面' }, { key: 'rename', label: '重命名页面' }, { key: 'duplicate', label: '复制此页' }, { key: 'move', label: '移动页面' },
      { type: 'divider' }, { key: 'up', label: '上移' }, { key: 'down', label: '下移' }, { type: 'divider' }, { key: 'delete', label: '删除页面', danger: true },
    ] as NonNullable<MenuProps['items']>).map(item=>!item || item.type==='divider' || item.key==='import-report'?item:{...item,disabled:!session.can(item.key === 'delete' ? 'page.delete' : 'page.manage')}), onClick: info => { info.domEvent.stopPropagation(); pageAction(info.key, page); } }}><button aria-label={`页面操作 ${page.name}`} disabled={busy} onClick={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}><MoreOutlined/></button></Dropdown></span>, children: nodes(page.id) }));
  }
  return <div className="page-manager"><div className="page-project-controls"><ProjectSwitcher/></div><div className="page-manager-heading"><span>项目页面 <span>{pages.length}</span></span><div><button aria-label="刷新页面列表" title="刷新页面列表" disabled={busy} onClick={refresh}><ReloadOutlined/></button><button aria-label="新建根页面" title="新建页面" disabled={busy || !session.can('page.manage')} onClick={() => name({ kind: 'new-page' })}><PlusOutlined/></button></div></div>
    <Spin spinning={busy}><Tree className="prototype-page-tree" blockNode showIcon showLine={{ showLeafIcon: false }} disabled={busy} treeData={nodes(null)} selectedKeys={[session.currentPageId]} expandedKeys={expanded} onExpand={keys => setExpanded(keys)} onSelect={keys => { if (keys[0] && keys[0] !== session.currentPageId) selectPage(String(keys[0])); }}/></Spin>
    <p className="page-tree-help">点击页面名称切换画布。<br/>通过右侧「···」管理子页面。</p><Button aria-label="新建页面" block size="small" icon={<PlusOutlined/>} disabled={busy || !session.can('page.manage')} onClick={() => name({ kind: 'new-page' })}>新建页面</Button>
  </div>;
}
