export function mcpConnectionConfig(url: string, projectId: string, versionId: string) {
  const origin = url.trim().replace(/\/+$/, '');
  const endpoint = `${origin}/mcp`;
  const previewUrl = `${origin}/preview?${new URLSearchParams({ projectId, versionId })}`;
  const codex = ['[mcp_servers.forma_prototype]', `url = ${JSON.stringify(endpoint)}`].join('\n');
  const claude = JSON.stringify({ mcpServers: { forma_prototype: { type: 'http', url: endpoint } } }, null, 2);
  return { endpoint, previewUrl, codex, claude };
}
