import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Spin, Tree } from 'antd';
import { FileOutlined, LayoutOutlined, CommentOutlined, ReloadOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import type { DataNode } from 'antd/es/tree';
import type { PageInfo, ProjectInfo } from '../shared/projects';
import type { PrototypeDocument } from '../shared/model';
import { PrototypePlayer } from './PrototypePlayer';

const locationState = () => {
  const query = new URLSearchParams(window.location.search);
  return { projectId: query.get('projectId') || '', pageId: query.get('pageId') || '', dialogId: query.get('dialogId') || '', versionId: query.get('versionId') || '' };
};
async function get<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const result = await response.json();
  if (!response.ok) throw Error(result.message || '读取预览失败');
  return result;
}
export default function ProjectPreview() {
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [route, setRoute] = useState(locationState);
  const [metadata, setMetadata] = useState<{ project: ProjectInfo; pages: PageInfo[]; version?: { name: string } } | null>(null);
  const [loaded, setLoaded] = useState<{ pageId: string; document: PrototypeDocument; revision: number } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [expanded, setExpanded] = useState<React.Key[]>([]);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const selected = metadata?.project.id === route.projectId ? metadata.pages.find(page => page.id === route.pageId) || metadata.pages[0] : undefined;
  const current = loaded && loaded.pageId === selected?.id ? loaded : null;
  function navigate(pageId: string, replace = false) {
    const query = new URLSearchParams({ projectId: route.projectId, pageId });
    if (route.versionId) query.set('versionId', route.versionId);
    window.history[replace ? 'replaceState' : 'pushState'](null, '', `/preview?${query}`);
    setRoute(locationState());
  }
  useEffect(() => {
    const popstate = () => setRoute(locationState());
    window.addEventListener('popstate', popstate); return () => window.removeEventListener('popstate', popstate);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setMetadata(null); setLoaded(null); setLoading(true); setError(''); setExpanded([]);
    if (!route.projectId) { setError('预览地址缺少项目，请从编辑器打开预览。'); setLoading(false); return () => controller.abort(); }
    void (async () => {
      if (route.versionId) {
        const snapshot = await get<{ project: ProjectInfo; pages: PageInfo[]; version: { name: string } }>(`/api/projects/${encodeURIComponent(route.projectId)}/versions/${encodeURIComponent(route.versionId)}`, controller.signal);
        if (controller.signal.aborted) return;
        setMetadata(snapshot); setExpanded(snapshot.pages.filter(page => snapshot.pages.some(child => child.parentId === page.id)).map(page => page.id));
        if (!snapshot.pages.length) setLoading(false);
        return;
      }
      const projects = await get<{ projects: ProjectInfo[] }>('/api/projects', controller.signal);
      if (controller.signal.aborted) return;
      const project = projects.projects.find(item => item.id === route.projectId);
      if (!project) throw Error('项目不存在或已被删除');
      const pages = await get<{ pages: PageInfo[] }>(`/api/projects/${encodeURIComponent(route.projectId)}/pages`, controller.signal);
      if (controller.signal.aborted) return;
      setMetadata({ project, pages: pages.pages });
      setExpanded(pages.pages.filter(page => pages.pages.some(child => child.parentId === page.id)).map(page => page.id));
      if (!pages.pages.length) setLoading(false);
    })().catch(error => { if (!controller.signal.aborted) { setError(error.message); setLoading(false); } });
    return () => controller.abort();
  }, [route.projectId, route.versionId, refresh]);
  useEffect(() => {
    if (!selected || !metadata) return;
    if (selected.id !== route.pageId) navigate(selected.id, true);
    const parents: string[] = []; let page: PageInfo | undefined = selected;
    while (page?.parentId && !parents.includes(page.parentId)) { parents.push(page.parentId); page = metadata.pages.find(item => item.id === page?.parentId); }
    setExpanded(old => [...new Set([...old, ...parents])]);
  }, [selected?.id, metadata]);
  useEffect(() => {
    if (!selected || !metadata) return;
    const controller = new AbortController();
    setLoaded(null); setLoading(true); setError('');
    void get<{ document: PrototypeDocument; revision: number }>(route.versionId ? `/api/projects/${encodeURIComponent(route.projectId)}/versions/${encodeURIComponent(route.versionId)}/pages/${encodeURIComponent(selected.id)}` : `/api/pages/${encodeURIComponent(selected.id)}/document`, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setLoaded({ ...result, pageId: selected.id }); setLoading(false);
      scroll.current?.scrollTo(0, 0);
    }).catch(error => { if (!controller.signal.aborted) { setError(error.message); setLoading(false); } });
    return () => controller.abort();
  }, [selected?.id, metadata, route.versionId, refresh]);
  useEffect(() => { document.title = `${selected?.name ? selected.name + ' · ' : ''}${metadata?.project.name || '项目'} · 原型预览`; }, [selected?.name, metadata?.project.name]);
  function nodes(parentId: string | null): DataNode[] {
    return (metadata?.pages || []).filter(page => page.parentId === parentId).map(page => ({ key: page.id, icon: <FileOutlined/>, title: <span title={page.name}>{page.name}</span>, children: nodes(page.id) }));
  }
  return <div className="project-preview">
    <header className="preview-toolbar"><div><Button type="text" aria-label={sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'} title={sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'} aria-expanded={sidebarVisible} aria-controls="preview-sidebar" icon={sidebarVisible ? <MenuFoldOutlined/> : <MenuUnfoldOutlined/>} onClick={() => setSidebarVisible(visible => !visible)}/><span className="brand-mark small"><LayoutOutlined/></span><strong title={metadata?.project.name}>{metadata?.project.name || '项目预览'}</strong><span className="preview-badge">{route.versionId ? `${metadata?.version?.name || '固定版本'} · 只读预览` : '工作草稿 · 交互预览'}</span></div><div><Button className="preview-annotation-toggle" aria-label={showAnnotations ? '隐藏预览标注' : '显示预览标注'} aria-pressed={showAnnotations} icon={<CommentOutlined/>} onClick={() => setShowAnnotations(value => !value)}>标注{current?.document.annotations?.length ? ` · ${current.document.annotations.length}` : ''}</Button><Button aria-label="刷新项目预览" icon={<ReloadOutlined/>} onClick={() => setRefresh(old => old + 1)}>刷新</Button><Button aria-label="返回编辑" onClick={() => { window.close(); window.setTimeout(() => window.location.assign('/'), 100); }}>返回编辑</Button></div></header>
    <div className="project-preview-layout"><aside id="preview-sidebar" className="preview-sidebar" aria-label="项目页面树" hidden={!sidebarVisible}><div className="preview-tree-heading"><strong>项目页面</strong><span>{metadata?.pages.length || 0}</span></div><Tree className="preview-page-tree" blockNode showIcon showLine={{ showLeafIcon: false }} treeData={nodes(null)} expandedKeys={expanded} onExpand={setExpanded} selectedKeys={selected ? [selected.id] : []} onSelect={keys => { if (keys[0] && keys[0] !== selected?.id) navigate(String(keys[0])); }}/></aside>
      <main className="preview-main"><div className="preview-page-heading"><strong>{selected?.name || '原型预览'}</strong><span>{current ? `${current.document.width} × ${current.document.height}` : ''}</span></div><div className="preview-scroll" ref={scroll}>
        {error ? <Alert type="error" showIcon message="无法打开预览" description={error} action={<Button onClick={() => setRefresh(old => old + 1)}>重试</Button>}/> : loading ? <div className="preview-loading"><Spin tip="正在读取原型"><div/></Spin></div> : current ? <PrototypePlayer key={`${current.pageId}:${current.revision}`} doc={current.document} showAnnotations={showAnnotations} initialDialogId={route.dialogId || undefined}/> : <Empty description="项目暂无页面"/>}
      </div></main>
    </div><footer className="preview-bottom"><span>交互演示 · 数据仅用于当前预览</span><span>点击左侧页面切换原型</span></footer>
  </div>;
}
