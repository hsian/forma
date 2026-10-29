import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { bindingFromEnv, PrototypeClient } from './client.js';
import { createPrototypeMcp } from './server.js';

try {
  const client = new PrototypeClient(bindingFromEnv(process.env));
  const server = createPrototypeMcp(client);
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error(error instanceof Error ? error.message : '原型 MCP 启动失败');
  process.exitCode = 1;
}
