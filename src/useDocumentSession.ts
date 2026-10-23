import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from './store';
import type { PrototypeDocument } from '../shared/model';
import type { PageInfo, ProjectInfo } from '../shared/projects';
import type { PageLease, ProjectRole } from '../shared/auth';

export type SaveStatus = 'loading' | 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';
interface Bootstrap {
  document: PrototypeDocument; revision: number; updatedAt: number;
  page: PageInfo; project: ProjectInfo;
  projectRole: ProjectRole;
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
  const [projectRole, setProjectRole] = useState<ProjectRole>('viewer');
  const [lease, setLease] = useState<PageLease>({ owned: false });
  const [leaseError, setLeaseError] = useState('');
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const editingAllowed = useRef(false);
  const roleRef = useRef<ProjectRole>('viewer');
  const leaseRef = useRef<PageLease>({ owned: false });
  const acquiring = useRef<Promise<boolean> | null>(null);
  const releasing = useRef<Promise<void> | null>(null);
  const leaseEpoch = useRef(0);
  const lastEdit = useRef(0);
  const aiRuns = useRef(0);
  function updateLease(value: PageLease) {
    editingAllowed.current = value.owned; leaseRef.current = value; setLease(value);
    useEditor.getState().setReadOnly(roleRef.current === 'viewer' || !!value.username && !value.owned);
  }
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
    if (!active.current || !loaded.current || blocked.current || !editingAllowed.current) return;
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

  type EditSnapshot = Pick<ReturnType<typeof useEditor.getState>, 'doc' | 'past' | 'future'>;
  const ensureEditing = useCallback((snapshot?: EditSnapshot): Promise<boolean> => {
    if (!active.current || !loaded.current || roleRef.current === 'viewer') return Promise.resolve(false);
    lastEdit.current = Date.now();
    if (acquiring.current) return acquiring.current;
    if (editingAllowed.current && !releasing.current) return Promise.resolve(true);
    ++leaseEpoch.current;
    const id = pageId.current, stamp = generation.current;
    const cleanBefore = snapshot ? JSON.stringify(snapshot.doc) === savedJSON.current : JSON.stringify(useEditor.getState().doc) === savedJSON.current;
    const restore = (document?: PrototypeDocument) => {
      if (document) useEditor.getState().replace(document);
      else if (snapshot) useEditor.setState({ doc: snapshot.doc, past: snapshot.past, future: snapshot.future, selected: [] });
      setCanvasEpoch(value => value + 1);
    };
    const work = (async () => {
      await releasing.current;
      let acquired = false;
      try {
        const response = await fetch(`/api/pages/${encodeURIComponent(id)}/lease`, { method: 'POST' });
        const result = await response.json(); acquired = response.ok;
        if (!active.current || generation.current !== stamp) { if (acquired) await fetch(`/api/pages/${encodeURIComponent(id)}/lease`, { method: 'DELETE', keepalive: true }); return false; }
        if (!response.ok) {
          if (result.lease) updateLease(result.lease);
          throw Error(result.lease?.username ? `${result.lease.username} 正在编辑，本次修改未应用；对方空闲后即可继续修改` : result.message || '无法取得编辑权，请稍后重试');
        }
        const latestResponse = await fetch(`/api/pages/${encodeURIComponent(id)}/document`);
        if (!latestResponse.ok) throw Error('无法读取最新页面，本次修改未保存');
        const latest = await latestResponse.json();
        if (!active.current || generation.current !== stamp) { await fetch(`/api/pages/${encodeURIComponent(id)}/lease`, { method: 'DELETE', keepalive: true }); return false; }
        const baseline = snapshot?.doc || JSON.parse(savedJSON.current);
        if (canonicalJSON(latest.document) !== canonicalJSON(baseline)) {
          if (cleanBefore) {
            restore(latest.document); savedJSON.current = JSON.stringify(latest.document); revision.current = latest.revision;
            if (snapshot) {
              await fetch(`/api/pages/${encodeURIComponent(id)}/lease`, { method: 'DELETE' }); acquired = false;
              updateLease({ owned: false }); setSaveStatus('saved');
              setLeaseError('页面已有更新，已载入最新内容，请重新执行刚才的修改'); return false;
            }
          } else {
            blocked.current = 'conflict'; setSaveStatus('conflict'); setSaveError('页面已被其他窗口更新。未保存的本地修改已保留，请核对后重新载入。');
            await fetch(`/api/pages/${encodeURIComponent(id)}/lease`, { method: 'DELETE' }); acquired = false; updateLease({ owned: false }); return false;
          }
        }
        revision.current = latest.revision;
        updateLease(result.lease); setLeaseError(''); return true;
      } catch (error) {
        if (active.current && generation.current === stamp) {
          if (snapshot && cleanBefore) { restore(); setSaveStatus('saved'); }
          setLeaseError(error instanceof Error ? error.message : '无法取得编辑权');
        }
        if (acquired) {
          await fetch(`/api/pages/${encodeURIComponent(id)}/lease`, { method: 'DELETE', keepalive: true }).catch(() => {});
          if (active.current && generation.current === stamp) updateLease({ owned: false });
        }
        return false;
      }
    })();
    acquiring.current = work;
    void work.finally(() => { if (acquiring.current === work) acquiring.current = null; });
    return work;
  }, []);

  useEffect(() => useEditor.subscribe((next, previous) => {
    if (next.editSerial === previous.editSerial || !loaded.current || !active.current) return;
    lastEdit.current = Date.now();
    if (!editingAllowed.current || releasing.current) {
      setSaveStatus('unsaved');
      void ensureEditing(previous).then(acquired => { if (acquired) void saveNow(); });
    }
  }), [ensureEditing, saveNow]);

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
      const leaseResponse = await fetch(`/api/pages/${encodeURIComponent(data.page.id)}/lease`, { signal: abort.signal });
      const leaseData = await leaseResponse.json();
      if (!leaseResponse.ok && leaseResponse.status !== 423) throw Error(leaseData.message || '无法取得页面编辑状态');
      if (!active.current || generation.current !== currentGeneration) return false;
      if (pageId.current && pageId.current !== data.page.id) void fetch(`/api/pages/${encodeURIComponent(pageId.current)}/lease`, { method: 'DELETE', keepalive: true });
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
      roleRef.current = data.projectRole; aiRuns.current = 0; lastEdit.current = Date.now();
      setProjectRole(data.projectRole); updateLease(leaseData.lease); setLeaseError('');
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
    active.current = true; useEditor.getState().setReadOnly(true); void load(true);
    return () => { active.current = false; loaded.current = false; ++generation.current; loadAbort.current?.abort(); cancelTimer(); if (pageId.current) void fetch(`/api/pages/${encodeURIComponent(pageId.current)}/lease`, { method: 'DELETE', keepalive: true }); useEditor.getState().setReadOnly(true); };
  }, [load, cancelTimer]);

  useEffect(() => {
    cancelTimer();
    if (server !== 'ready' || !loaded.current || inFlight.current || blocked.current === 'conflict' || !lease.owned) return;
    if (JSON.stringify(doc) === savedJSON.current) {
      blocked.current = null; setSaveStatus('saved'); setSaveError(''); return;
    }
    if (blocked.current) return;
    setSaveStatus('unsaved');
    timer.current = setTimeout(() => { void saveNow(); }, 600);
    return cancelTimer;
  }, [doc, server, saveNow, cancelTimer, lease.owned]);

  const retry = useCallback(() => {
    if (!loaded.current) { void load(initialLoad.current); return; }
    if (blocked.current === 'conflict') return;
    blocked.current = null; void ensureEditing().then(acquired => { if (acquired) void saveNow(); });
  }, [load, saveNow, ensureEditing]);
  const flush = useCallback(async () => {
    cancelTimer();
    if (acquiring.current) await acquiring.current;
    if (!editingAllowed.current && loaded.current && !blocked.current && JSON.stringify(useEditor.getState().doc) !== savedJSON.current) await ensureEditing();
    if (!editingAllowed.current) return loaded.current && JSON.stringify(useEditor.getState().doc) === savedJSON.current;
    do { await saveNow(); }
    while (active.current && loaded.current && editingAllowed.current && !blocked.current && JSON.stringify(useEditor.getState().doc) !== savedJSON.current);
    return loaded.current && !blocked.current && JSON.stringify(useEditor.getState().doc) === savedJSON.current;
  }, [cancelTimer, saveNow, ensureEditing]);
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
  async function beginAi() {
    const stamp = generation.current;
    if (!await ensureEditing() || stamp !== generation.current) return null;
    aiRuns.current++; lastEdit.current = Date.now();
    return () => { if (stamp === generation.current) { aiRuns.current = Math.max(0, aiRuns.current - 1); lastEdit.current = Date.now(); } };
  }
  useEffect(() => {
    if (!currentPageId || server !== 'ready') return;
    let cancelled = false; let checking = false; let lastRemoteCheck = Date.now();
    const check = async () => {
      if (checking || acquiring.current || releasing.current) return;
      const idle = editingAllowed.current && Date.now() - lastEdit.current >= 60000;
      const releasable = idle && !aiRuns.current && !inFlight.current && !blocked.current && JSON.stringify(useEditor.getState().doc) === savedJSON.current;
      if (!releasable && Date.now() - lastRemoteCheck < 15000) return;
      checking = true; lastRemoteCheck = Date.now();
      const epoch = leaseEpoch.current;
      try {
        if (releasable) {
          const oldLease = leaseRef.current;
          updateLease({ owned: false });
          const release = (async () => {
            try {
              const response = await fetch(`/api/pages/${encodeURIComponent(currentPageId)}/lease`, { method: 'DELETE' });
              if (!response.ok) throw Error('自动释放编辑权失败，稍后重试');
            } catch (error) { if (!cancelled) { updateLease(oldLease); setLeaseError((error as Error).message); } }
          })();
          releasing.current = release;
          await release; if (releasing.current === release) releasing.current = null;
          return;
        }
        const response = await fetch(`/api/pages/${encodeURIComponent(currentPageId)}/lease`, { method: editingAllowed.current ? 'POST' : 'GET' });
        const result = await response.json();
        if (cancelled || epoch !== leaseEpoch.current || acquiring.current || releasing.current) return;
        if (!response.ok && response.status !== 423) throw Error(result.message || '无法确认编辑权');
        updateLease(result.lease); setLeaseError('');
        if (!result.lease.owned && JSON.stringify(useEditor.getState().doc) === savedJSON.current) {
          const latestResponse = await fetch(`/api/pages/${encodeURIComponent(currentPageId)}/document`);
          if (!latestResponse.ok) return;
          const latest = await latestResponse.json();
          if (!cancelled && epoch === leaseEpoch.current && !editingAllowed.current && JSON.stringify(useEditor.getState().doc) === savedJSON.current && latest.revision !== revision.current) {
            useEditor.getState().replace(latest.document); revision.current = latest.revision; savedJSON.current = JSON.stringify(latest.document);
          }
        }
      } catch (error) { if (!cancelled && epoch === leaseEpoch.current) { updateLease({ owned: false }); setLeaseError((error as Error).message); } }
      finally { checking = false; }
    };
    const interval = setInterval(() => { void check(); }, 5000);
    const pagehide = () => { if (editingAllowed.current) void fetch(`/api/pages/${encodeURIComponent(currentPageId)}/lease`, { method: 'DELETE', keepalive: true }); };
    window.addEventListener('pagehide', pagehide);
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('pagehide', pagehide); };
  }, [currentPageId, server]);
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
  return { server, saveStatus, saveError, pageName, projectName, currentPageId, currentProjectId, projectRole, canEdit: server === 'ready' && projectRole !== 'viewer' && (!lease.username || lease.owned), lease, leaseError, canvasEpoch, beginAi, retry, flush, reload, switchPage, refreshMetadata };
}
export type DocumentSession = ReturnType<typeof useDocumentSession>;
