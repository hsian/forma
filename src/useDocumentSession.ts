import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from './store';
import type { PrototypeDocument } from '../shared/model';
import type { PageInfo, ProjectInfo } from '../shared/projects';

export type SaveStatus = 'loading' | 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';
interface Bootstrap {
  document: PrototypeDocument; revision: number; updatedAt: number;
  page: PageInfo; project: ProjectInfo;
}
export const saveLabels: Record<SaveStatus, string> = {
  loading: '正在读取', saved: '已保存', unsaved: '等待保存', saving: '正在保存', error: '保存失败', conflict: '保存冲突',
};
const canonicalJSON = (value: unknown) => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export function useDocumentSession() {
  const doc = useEditor(state => state.doc);
  const [server, setServer] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('loading');
  const [saveError, setSaveError] = useState('');
  const [pageName, setPageName] = useState('用户管理');
  const [projectName, setProjectName] = useState('单页原型探索');
  const [currentPageId, setCurrentPageId] = useState('');
  const [currentProjectId, setCurrentProjectId] = useState('');
  const active = useRef(false);
  const loaded = useRef(false);
  const initialLoad = useRef(true);
  const generation = useRef(0);
  const pageId = useRef('');
  const revision = useRef(0);
  const savedJSON = useRef('');
  const blocked = useRef<'error' | 'conflict' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const loadAbort = useRef<AbortController | null>(null);
  const switching = useRef(false);

  const cancelTimer = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; }, []);
  const saveNow = useCallback(async (): Promise<void> => {
    cancelTimer();
    if (!active.current || !loaded.current || blocked.current) return;
    if (inFlight.current) return inFlight.current;
    const document = useEditor.getState().doc;
    const json = JSON.stringify(document);
    if (json === savedJSON.current) { setSaveStatus('saved'); return; }
    const currentGeneration = generation.current;
    const currentPageId = pageId.current;
    const currentRevision = revision.current;
    setSaveStatus('saving'); setSaveError('');
    inFlight.current = (async () => {
      let acknowledged = false;
      try {
        const response = await fetch(`/api/pages/${encodeURIComponent(currentPageId)}/document`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: currentRevision, document }),
        });
        const result = await response.json();
        if (!active.current || generation.current !== currentGeneration) return;
        if (response.status === 404) {
          blocked.current = 'conflict'; setSaveStatus('conflict');
          setSaveError('此页面已被其他窗口删除。当前修改仍保留在本窗口，请复制所需内容后重新载入。');
          return;
        }
        if (response.status === 409) {
          // The previous response may have been lost after a successful commit.
          // A matching document acknowledges that retry without overwriting another tab.
          const latestResponse = await fetch(`/api/pages/${encodeURIComponent(currentPageId)}/document`);
          if (latestResponse.status === 404) {
            blocked.current = 'conflict'; setSaveStatus('conflict'); setSaveError('此页面已被删除，请保留所需内容后重新载入。'); return;
          }
          if (!latestResponse.ok) throw Error('无法读取服务器版本，请稍后重试');
          const latest = await latestResponse.json();
          if (!active.current || generation.current !== currentGeneration) return;
          if (canonicalJSON(latest.document) !== canonicalJSON(document)) {
            blocked.current = 'conflict'; setSaveStatus('conflict');
            setSaveError('其他窗口已更新此页面。当前修改仍保留在本窗口，请核对后重新载入。');
            return;
          }
          revision.current = latest.revision;
        } else {
          if (!response.ok) throw Error(result.message || '保存失败，请稍后重试');
          revision.current = result.revision;
        }
        savedJSON.current = json;
        acknowledged = true;
      } catch (error) {
        if (active.current && generation.current === currentGeneration) {
          blocked.current = 'error'; setSaveStatus('error');
          setSaveError(error instanceof Error ? error.message : '保存失败，请检查本地服务');
        }
      } finally {
        inFlight.current = null;
        if (active.current && generation.current === currentGeneration && acknowledged) {
          const dirty = JSON.stringify(useEditor.getState().doc) !== savedJSON.current;
          setSaveStatus(dirty ? 'unsaved' : 'saved');
          // Exactly one request runs at a time; edits made during a request are sent next.
          if (dirty) timer.current = setTimeout(() => { void saveNow(); }, 0);
        }
      }
    })();
    return inFlight.current;
  }, [cancelTimer]);

  const load = useCallback(async (preserveExistingWork: boolean, requestedPageId?: string): Promise<boolean> => {
    cancelTimer(); loadAbort.current?.abort();
    const abort = new AbortController(); loadAbort.current = abort;
    const currentGeneration = ++generation.current;
    loaded.current = false; blocked.current = null;
    setServer('loading'); setSaveStatus('loading'); setSaveError('');
    try {
      let targetPageId = requestedPageId || pageId.current;
      if (!targetPageId) { try { targetPageId = localStorage.getItem('forma:last-page') || ''; } catch {} }
      const response = await fetch(`/api/bootstrap${targetPageId ? '?pageId=' + encodeURIComponent(targetPageId) : ''}`, { signal: abort.signal });
      if (!response.ok) throw Error('读取项目失败，请检查本地服务');
      const data: Bootstrap = await response.json();
      if (!active.current || generation.current !== currentGeneration) return false;
      const existing = useEditor.getState();
      // On the first upgrade, preserve work already edited in the live in-memory editor.
      const keepLocal = preserveExistingWork && pageId.current === data.page.id && data.revision === 0 && existing.past.length > 0;
      initialLoad.current = false;
      pageId.current = data.page.id; revision.current = data.revision;
      savedJSON.current = JSON.stringify(data.document);
      if (!keepLocal) existing.replace(data.document);
      loaded.current = true;
      setPageName(data.page.name); setProjectName(data.project.name);
      setCurrentPageId(data.page.id); setCurrentProjectId(data.project.id);
      try { localStorage.setItem('forma:last-page', data.page.id); } catch {}
      setServer('ready'); setSaveStatus(keepLocal ? 'unsaved' : 'saved');
      return true;
    } catch (error) {
      if (active.current && !abort.signal.aborted && generation.current === currentGeneration) {
        setServer('error'); setSaveStatus('error');
        setSaveError(error instanceof Error ? error.message : '读取项目失败');
      }
      return false;
    }
  }, [cancelTimer]);

  useEffect(() => {
    active.current = true; void load(true);
    return () => { active.current = false; loaded.current = false; ++generation.current; loadAbort.current?.abort(); cancelTimer(); };
  }, [load, cancelTimer]);

  useEffect(() => {
    cancelTimer();
    if (server !== 'ready' || !loaded.current || inFlight.current || blocked.current === 'conflict') return;
    if (JSON.stringify(doc) === savedJSON.current) {
      blocked.current = null; setSaveStatus('saved'); setSaveError(''); return;
    }
    if (blocked.current) return;
    setSaveStatus('unsaved');
    timer.current = setTimeout(() => { void saveNow(); }, 600);
    return cancelTimer;
  }, [doc, server, saveNow, cancelTimer]);

  const retry = useCallback(() => {
    if (!loaded.current) { void load(initialLoad.current); return; }
    if (blocked.current === 'conflict') return;
    blocked.current = null; void saveNow();
  }, [load, saveNow]);
  const flush = useCallback(async () => {
    cancelTimer();
    do { await saveNow(); }
    while (active.current && loaded.current && !blocked.current && JSON.stringify(useEditor.getState().doc) !== savedJSON.current);
    return loaded.current && !blocked.current && JSON.stringify(useEditor.getState().doc) === savedJSON.current;
  }, [cancelTimer, saveNow]);
  const switchPage = useCallback(async (nextPageId: string): Promise<boolean> => {
    if (switching.current || !loaded.current) return false;
    if (nextPageId === pageId.current) return true;
    switching.current = true;
    try {
      if (!await flush()) return false;
      return await load(false, nextPageId);
    } finally { switching.current = false; }
  }, [flush, load]);
  const refreshMetadata = useCallback(async () => {
    const id = pageId.current;
    if (!id) return;
    const response = await fetch(`/api/bootstrap?pageId=${encodeURIComponent(id)}`);
    if (!response.ok) return;
    const data: Bootstrap = await response.json();
    if (active.current && pageId.current === id && data.page.id === id) { setPageName(data.page.name); setProjectName(data.project.name); }
  }, []);
  const reload = useCallback(async () => { await inFlight.current; await load(false); }, [load]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (loaded.current && (inFlight.current || JSON.stringify(useEditor.getState().doc) !== savedJSON.current)) {
        event.preventDefault(); event.returnValue = '';
      }
    };
    const online = () => { if (blocked.current === 'error') retry(); };
    window.addEventListener('beforeunload', beforeUnload); window.addEventListener('online', online);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('online', online); };
  }, [retry]);
  return { server, saveStatus, saveError, pageName, projectName, currentPageId, currentProjectId, retry, flush, reload, switchPage, refreshMetadata };
}
export type DocumentSession = ReturnType<typeof useDocumentSession>;
