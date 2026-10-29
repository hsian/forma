import { useState } from 'react';
import { Alert, App, Button, Collapse, Input, Modal, Tabs } from 'antd';
import { mcpConnectionConfig } from '../shared/mcp-connection';

export function McpConnection({ projectId, version, onClose }: { projectId: string; version: { id: string; name: string }; onClose: () => void }) {
  const { message } = App.useApp();
  const [url, setUrl] = useState(window.location.origin);
  const [client, setClient] = useState('codex');
  const config = mcpConnectionConfig(url, projectId, version.id);
  const text = client === 'codex' ? config.codex : config.claude;
  let valid = false;
  try { const value = new URL(url); valid = ['http:', 'https:'].includes(value.protocol) && value.pathname === '/' && !value.username && !value.password && !value.search && !value.hash; } catch {}
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); void message.success(`已复制${label}`); }
    catch { void message.warning('无法访问剪贴板，请在配置框中全选复制'); }
  }
  return <Modal open title={`接入 MCP · ${version.name}`} width={640} style={{ top: 48 }} styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }} onCancel={onClose} footer={<Button onClick={onClose}>关闭</Button>}>
    <p>MCP 只需配置一次。以后把“查看版本”链接发给 Codex 或 Claude，即可读取对应项目和版本。</p>
    <ol style={{ paddingLeft: 22, lineHeight: 2 }}>
      <li>在开发工具中添加 MCP 服务器，类型选择 <strong>Streamable HTTP</strong>。</li>
      <li>名称填写 <strong>forma_prototype</strong>，地址粘贴下方链接，无需鉴权。</li>
      <li>保存后，将下方版本链接和本次需求一起发给 AI。换版本时只换链接，无需修改 MCP 配置。</li>
    </ol>
    <label className="stacked-label">MCP 地址<Input.TextArea aria-label="MCP 地址" readOnly value={config.endpoint} autoSize={{ minRows: 2, maxRows: 4 }} /></label>
    <Button type="primary" disabled={!valid} onClick={() => { void copy(config.endpoint, 'MCP 地址'); }}>复制 MCP 地址</Button>
    <label className="stacked-label" style={{ marginTop: 16 }}>发给 AI 的版本链接<Input.TextArea aria-label="原型版本链接" readOnly value={config.previewUrl} autoSize={{ minRows: 2, maxRows: 4 }} /></label>
    <Button disabled={!valid} onClick={() => { void copy(config.previewUrl, '版本链接'); }}>复制版本链接</Button>
    <Alert style={{ marginTop: 16 }} type="info" showIcon message="原型服务需保持运行。其他电脑连接时，请在下方将服务地址改为服务器的局域网地址。" />
    <Collapse style={{ marginTop: 16 }} items={[{ key: 'settings', label: '其他电脑连接 / 手动配置', children: <>
      <label className="stacked-label">原型服务地址<Input aria-label="MCP 原型服务地址" value={url} onChange={e => setUrl(e.target.value)} /></label>
      {!valid && <p role="alert">请填写有效的服务根地址，例如 http://192.168.1.20:6060。</p>}
      <Tabs activeKey={client} onChange={setClient} items={[{ key: 'codex', label: 'Codex' }, { key: 'claude', label: 'Claude Code' }]} />
      <p>{client === 'codex' ? '如果没有添加入口，将下方内容合并到 ~/.codex/config.toml，保存后重启 Codex。已有同名配置时，替换整个 forma_prototype 配置段。' : '将下方内容合并到开发项目的 .mcp.json。已有同名配置时替换。'}</p>
      <Input.TextArea aria-label="MCP 配置模板" readOnly value={text} autoSize={{ minRows: 3, maxRows: 10 }} style={{ fontFamily: 'monospace' }} />
      <p className="property-note">旧的 command、args、cwd 和 env 配置请一并移除。</p>
      <Button disabled={!valid} onClick={() => { void copy(text, '配置'); }}>复制配置</Button>
    </> }]} />
    <p className="property-note" style={{ marginTop: 16 }}>上方 MCP 地址供所有项目和版本共用；版本链接指定「{version.name}」。知道版本链接即可只读访问，删除版本后停止读取。</p>
  </Modal>;
}
