import { randomId } from '../shared/uuid';
import { useEffect, useRef, useState } from 'react';
import { Button, Input, Tooltip } from 'antd';
import { MinusOutlined, CommentOutlined, SendOutlined, StopOutlined, RobotOutlined, UndoOutlined } from '@ant-design/icons';
import { canonicalDocument, type AiEvent, type AiMessage } from '../shared/ai';
import type { PrototypeDocument } from '../shared/model';
import type { DocumentSession } from './useDocumentSession';
import { useEditor } from './store';
import './ai-panel.css';

function preference(key: string, fallback: string) { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } }
const labels: Record<string, string> = { running: '处理中', applied: '已应用', conflict: '页面已变化，未应用', reverted: '已撤销', error: '未完成', cancelled: '已停止', done: '' };
export function AiPanel({ session, dialogId, visible = true }: { session: DocumentSession; dialogId?: string; visible?: boolean }) {
  const { doc, selected } = useEditor();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [draft, setDraft] = useState(() => preference(`forma:ai-draft:${session.currentPageId}`, ''));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [live, setLive] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<{ provider: string; codex: boolean; claude: boolean } | null>(null);
  const [lastChange, setLastChange] = useState<{ id: string; before: string; after: string } | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null); const sending = useRef(false); const mounted = useRef(false);
  const pageId = session.currentPageId;
  useEffect(() => { if (!session.canEdit) controller.current?.abort(); }, [session.canEdit]);
  const selectedNames = doc.elements.filter(e => selected.includes(e.id)).map(e => e.name);
  const currentDialog = doc.dialogs?.find(d => d.id === dialogId);
  const canonical = canonicalDocument(doc);
  const undoReady = lastChange && canonical === lastChange.after && canonicalDocument(useEditor.getState().past.at(-1)) === lastChange.before;
  useEffect(() => { try { localStorage.setItem(`forma:ai-draft:${pageId}`, draft); } catch {} }, [pageId, draft]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [messages, live, status, open, visible]);
  async function loadMessages(signal?: AbortSignal) {
    const response = await fetch(`/api/pages/${encodeURIComponent(pageId)}/ai/messages`, { signal });
    const result = await response.json();
    if (!response.ok) throw Error(result.message || '无法读取对话');
    if (mounted.current && !signal?.aborted) setMessages(result.messages);
  }
  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    void loadMessages(abort.signal).catch(error => { if (!abort.signal.aborted) setError(error.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    void fetch('/api/ai/config', { signal: abort.signal }).then(response => response.json()).then(config => { if (!abort.signal.aborted) setConfig(config); }).catch(() => {});
    return () => { mounted.current = false; abort.abort(); controller.current?.abort(); };
  }, [pageId]);
  async function acknowledge(id: string, status: string) {
    await fetch(`/api/pages/${encodeURIComponent(pageId)}/ai/messages/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
  }
  async function submit() {
    if (sending.current || !draft.trim() || loading || session.server !== 'ready' || !session.canEdit) return;
    const prompt = draft.trim(); const selectedIds = [...selected];
    const abort = new AbortController(); controller.current = abort; sending.current = true;
    setBusy(true); setError(''); setLive(''); setStatus('正在保存当前原型'); setDraft('');
    let received = false;
    let finishAi: (() => void) | null = null;
    try {
      finishAi = await session.beginAi();
      if (!finishAi) throw Error('未能取得页面编辑权，本轮没有修改原型。');
      if (!await session.flush()) throw Error('当前页面尚未保存，请先处理保存失败或冲突。');
      if (abort.signal.aborted || !mounted.current) return;
      const source = structuredClone(useEditor.getState().doc); const fingerprint = canonicalDocument(source);
      setMessages(old => [...old, { id: randomId(), role: 'user', content: prompt, status: 'done', provider: '', createdAt: Date.now() }]);
      const response = await fetch(`/api/pages/${encodeURIComponent(pageId)}/ai/turn`, { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, selectedIds, dialogId, baseDocument: source }) });
      if (!response.ok) { const value = await response.json(); throw Error(value.message || '发送失败'); }
      const reader = response.body?.getReader(); if (!reader) throw Error('未收到有效响应');
      const decoder = new TextDecoder(); let buffer = '';
      async function event(line: string) {
        if (!line.trim() || abort.signal.aborted || !mounted.current) return;
        const item: AiEvent = JSON.parse(line);
        if (item.type === 'status') setStatus(item.text);
        if (item.type === 'text') setLive(old => item.reset ? item.text : old + item.text);
        if (item.type === 'error') { received = true; setError(item.text); setDraft(old => old || prompt); }
        if (item.type === 'result') {
          received = true;
          const message = item.message;
          if (item.changed) {
            if (useEditor.getState().readOnly || canonicalDocument(useEditor.getState().doc) !== fingerprint) {
              message.status = 'conflict'; setError('生成期间页面已有修改，本轮结果未应用。请结合当前页面重新发送。');
            } else {
              const document: PrototypeDocument = structuredClone(item.document);
              useEditor.getState().commit(next => { Object.assign(next, document); next.dialogs = document.dialogs; });
              useEditor.getState().select(item.changedIds.filter(id => document.elements.find(e => e.id === id)?.parentId === dialogId));
              message.status = 'applied'; setLastChange({ id: message.id, before: fingerprint, after: canonicalDocument(useEditor.getState().doc) });
            }
            await acknowledge(message.id, message.status).catch(() => {});
          }
          setMessages(old => [...old, message]); setLive('');
        }
      }
      try {
        for (;;) {
          const chunk = await reader.read(); buffer += decoder.decode(chunk.value, { stream: !chunk.done });
          const lines = buffer.split('\n'); buffer = lines.pop() || '';
          for (const line of lines) await event(line);
          if (chunk.done) break;
        }
        if (buffer.trim()) await event(buffer);
      } finally { reader.releaseLock(); }
      if (!received && !abort.signal.aborted) throw Error('连接中断，没有应用不完整的修改，请重试。');
    } catch (error) {
      if (mounted.current) {
        setError(abort.signal.aborted ? '已停止，本轮未完成的修改不会应用。' : error instanceof Error ? error.message : '处理失败，请重试');
        if (!received) setDraft(old => old || prompt);
      }
    } finally {
      finishAi?.();
      sending.current = false;
      if (mounted.current) { setBusy(false); setStatus(''); setLive(''); void loadMessages().catch(() => {}); }
    }
  }
  const providerLabel = config ? config.provider === 'auto' ? '自动 · Codex 优先' : config.provider === 'claude' ? 'Claude' : 'Codex' : '';
  const scope = `页面：${session.pageName}${currentDialog ? ` · 弹窗：${currentDialog.title}` : ''} · ${selected.length ? `已选 ${selected.length} 项：${selectedNames.join('、')}` : '范围：当前页面'}`;
  const latest = messages.at(-1);
  const errorInHistory = latest?.role === 'assistant' && latest.content === error && latest.status === 'error';
  const notice = error || (busy ? status || 'AI 正在处理' : latest?.role === 'assistant' ? `${labels[latest.status] ? labels[latest.status] + ' · ' : ''}${latest.content}` : '');
  const undoButton = lastChange && <Tooltip title={undoReady ? '撤销这一轮 AI 修改' : '已有后续编辑，可用 Ctrl+Z 逐步撤销'}><Button type="text" size="small" aria-label="撤销本轮 AI 修改" disabled={!undoReady || busy || !session.canEdit} icon={<UndoOutlined/>} onClick={() => { if (!undoReady || !lastChange) return; void (async () => { const finish = await session.beginAi(); if (!finish) return; try { if (canonicalDocument(useEditor.getState().doc) !== lastChange.after) return; useEditor.getState().undo(); await acknowledge(lastChange.id, 'reverted'); await loadMessages(); setLastChange(null); } catch {} finally { finish(); } })(); }}/></Tooltip>;
  return <section id="ai-assistant-panel" className={`ai-panel ${open ? 'history-open' : ''}`} aria-label="AI 助手" aria-keyshortcuts="Control+`" hidden={!visible}>
    <div className="ai-history" id="ai-panel-history" hidden={!open}>
      <div className="ai-history-header"><strong>AI 对话</strong><span title={scope}>{scope}</span><span className="ai-provider">{providerLabel}</span><Button type="text" size="small" aria-label="收起 AI 对话记录" title="收起对话记录" icon={<MinusOutlined/>} onClick={() => setOpen(false)}/></div>
      <div className="ai-messages" ref={log} role="log" aria-label="AI 对话记录" aria-live="polite">{!messages.length && !busy && <div className="ai-welcome">描述想修改的内容，对话记录会显示在这里。</div>}{messages.map(message => <div key={message.id} className={`ai-message ${message.role}`}><div className="ai-message-heading">{message.role === 'user' ? '你' : 'AI 助手'}<span>{message.provider ? `${message.provider} · ` : ''}{labels[message.status] || ''}</span></div><div className="ai-message-text" role={message.status === 'error' ? 'alert' : undefined}>{message.content || '处理已中断，可重新发送。'}</div></div>)}{busy && <div className="ai-live"><span className="ai-working-dot"/>{live || status || '正在处理'}</div>}{error && !errorInHistory && <div className="ai-error" role="alert">{error}</div>}</div>
    </div>
    <div className="ai-composer"><div className="ai-input-row"><Tooltip title={scope}><span className="ai-input-mark" aria-label={scope}><RobotOutlined/></span></Tooltip><Input.TextArea aria-label="AI 修改要求" placeholder={selected.length ? `修改选中的${selected.length}个元素…` : '描述你想修改的原型…'} value={draft} autoSize={{ minRows: 1, maxRows: 3 }} maxLength={6000} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }}/>{undoButton}<Tooltip title={open ? '收起对话记录' : '查看对话记录'}><Button type="text" aria-label={open ? '折叠 AI 对话记录' : '展开 AI 对话记录'} aria-expanded={open} aria-controls="ai-panel-history" icon={<CommentOutlined/>} onClick={() => setOpen(value => !value)}/></Tooltip>{busy ? <Tooltip title="停止生成"><Button aria-label="停止 AI 生成" icon={<StopOutlined/>} onClick={() => { controller.current?.abort(); }}/></Tooltip> : <Tooltip title="发送 · Enter（Shift+Enter 换行）"><Button type="primary" aria-label="发送 AI 修改要求" disabled={!draft.trim() || loading || session.server !== 'ready' || !session.canEdit} icon={<SendOutlined/>} onClick={() => { void submit(); }}/></Tooltip>}</div>
      {notice && !open && <div className={`ai-inline-notice ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'} aria-live="polite"><button title={notice} onClick={() => setOpen(true)}>{busy && <span className="ai-working-dot"/>}<span>{notice}</span></button></div>}
    </div>
  </section>;
}
