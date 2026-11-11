import { useState } from 'react';
import { Button, Dropdown, Modal, Pagination, Popconfirm, Spin, Alert } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import type { AiMessage } from '../shared/ai';
import type { DocumentSession } from './useDocumentSession';

interface Conversation { id: string; title: string; createdAt: number }
export function AiConversationMenu({ session, disabled, currentId, onChanged, onWorking }: { session: DocumentSession; disabled: boolean; currentId: string | null; onChanged: (reset: boolean) => Promise<void>; onWorking: (value: boolean) => void }) {
  const [modal, context] = Modal.useModal();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<Conversation[]>([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [older, setOlder] = useState(false);
  const endpoint = `/api/pages/${encodeURIComponent(session.currentPageId)}/ai/conversations`;
  async function request(path: string, method = 'GET') {
    const response = await fetch(endpoint + path, { method }); const result = await response.json();
    if (!response.ok) throw Error(result.message || '操作失败'); return result;
  }
  async function list(next = 1) {
    const result = await request(`?page=${next}`); setRows(result.conversations); setMore(result.more); setPage(next);
  }
  async function run(action: () => Promise<void>) {
    if (working) return;
    setWorking(true); onWorking(true); setError('');
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : '操作失败'); setOpen(true); }
    finally { setWorking(false); onWorking(false); }
  }
  async function change(path: string, method: string) {
    const finish = await session.beginAi();
    if (!finish) throw Error('无法取得页面编辑权，请稍后重试');
    try { await request(path, method); await onChanged(method === 'POST' || path === '' || path === `/${encodeURIComponent(currentId || '')}`); setSelected(null); await list(); }
    finally { finish(); }
  }
  async function view(row: Conversation, before?: string) {
    const result = await request(`/${encodeURIComponent(row.id)}/messages${before ? `?beforeId=${encodeURIComponent(before)}` : ''}`);
    setSelected(row); setMessages(old => before ? [...result.messages, ...old] : result.messages); setOlder(result.more);
  }
  function confirmDelete(all: boolean, id?: string) {
    modal.confirm({ title: all ? '清空本页全部对话？' : '永久删除这段对话？', content: all ? '包括当前对话和所有归档，删除后无法恢复。已完成的原型修改会保留。' : '删除后无法恢复。已完成的原型修改会保留。', okText: '永久删除', okButtonProps: { danger: true }, cancelText: '取消', onOk: () => run(() => change(all ? '' : `/${encodeURIComponent(id!)}`, 'DELETE')) });
  }
  return <>{context}<Dropdown open={menuOpen} onOpenChange={setMenuOpen} trigger={['click']} menu={{ items: [
    { key: 'new', label: '新对话（自动归档当前聊天）', disabled: disabled || working || !session.canEdit },
    { key: 'history', label: '历史对话' },
    { key: 'delete', label: '删除当前对话', danger: true, disabled: disabled || working || !session.canEdit || !currentId },
  ], onClick: ({ key }) => {
    setMenuOpen(false);
    if (key === 'new') void run(() => change('', 'POST'));
    if (key === 'history') { setOpen(true); setSelected(null); void run(() => list()); }
    if (key === 'delete') confirmDelete(false, currentId!);
  } }}><Button type="text" size="small" icon={<MoreOutlined/>} aria-label="管理 AI 对话" disabled={working}/></Dropdown>
    <Modal title={selected ? selected.title : '历史对话'} open={open} onCancel={() => { if (!working) setOpen(false); }} footer={null} width={620}>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }}/>}<Spin spinning={working}>
      <div className="ai-archive-toolbar">{selected ? <Button onClick={() => setSelected(null)}>返回列表</Button> : <span>归档聊天可查看、恢复或删除</span>}
        {!selected && <Button danger disabled={disabled || working || !session.canEdit} onClick={() => confirmDelete(true)}>清空本页全部对话</Button>}
        {selected && <Button type="primary" disabled={disabled || working || !session.canEdit} onClick={() => void run(async () => { await change(`/${encodeURIComponent(selected.id)}/restore`, 'POST'); setOpen(false); })}>恢复并继续聊</Button>}
      </div>
      {selected ? <div className="ai-archive-messages">{older && <Button block onClick={() => void run(() => view(selected, messages[0]?.id))}>加载更早消息</Button>}{messages.map(message => <div key={message.id} className={`ai-message ${message.role}`}><div className="ai-message-heading">{message.role === 'user' ? '你' : 'AI 助手'}</div><div className="ai-message-text">{message.content}</div></div>)}</div> : <>
        {currentId && <Button block style={{ marginBottom: 12 }} onClick={() => void run(() => view({ id: currentId, title: '当前对话', createdAt: 0 }))}>查看当前对话完整记录</Button>}
        {!rows.length && <div className="ai-welcome">暂无归档。点击“新对话”后，当前聊天会保存在这里。</div>}
        {rows.map(row => <div className="ai-archive-row" key={row.id}><button onClick={() => void run(() => view(row))}><strong>{row.title}</strong><span>{new Date(row.createdAt).toLocaleString('zh-CN')}</span></button><Popconfirm title="永久删除这段聊天？" description="原型修改会保留，聊天无法恢复。" okText="删除" cancelText="取消" onConfirm={() => run(() => change(`/${encodeURIComponent(row.id)}`, 'DELETE'))}><Button danger type="text" disabled={disabled || working || !session.canEdit}>删除</Button></Popconfirm></div>)}
        <Pagination simple current={page} pageSize={20} total={(page + (more ? 1 : 0)) * 20} onChange={next => void run(() => list(next))} hideOnSinglePage/>
      </>}
      </Spin>
    </Modal>
  </>;
}
