import type { FastifyInstance } from 'fastify';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { createRepository } from '../db/repository.js';
import { createPrototypeMcp } from './server.js';

export function isPublicMcpTransport(method: string, path: string) {
  return ['POST', 'GET', 'HEAD', 'DELETE'].includes(method) && (path === '/mcp' || /^\/api\/mcp\/projects\/[^/]+\/versions\/[^/]+\/mcp$/.test(path));
}

/** Each URL pins a version. Each request owns its transport: no cross-client session state. */
export function registerPrototypeMcpHttp(app: FastifyInstance, repository: ReturnType<typeof createRepository>) {
  for (const path of ['/mcp', '/api/mcp/projects/:projectId/versions/:versionId/mcp']) {
  app.post<{ Params: { projectId?: string; versionId?: string } }>(path, { bodyLimit: 1024 * 1024 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const browserOrigin = request.headers.origin;
    if (browserOrigin) {
      try { if (new URL(browserOrigin).host !== request.headers.host) return reply.code(403).send({ message: '请求来源不正确' }); }
      catch { return reply.code(403).send({ message: '请求来源不正确' }); }
    }
    if (request.headers['sec-fetch-site'] === 'cross-site') return reply.code(403).send({ message: '请求来源不正确' });
    const origin = `${request.protocol}://${request.headers.host}`;
    const forVersion = (projectId: string, versionId: string, pageId?: string) => ({
      binding: { url: origin },
      selectedPageId: pageId,
      context: async () => {
        const { project, version, pages } = repository.readVersion(projectId, versionId);
        return { project, version: { id: version.id, name: version.name, description: version.description, createdAt: version.createdAt }, pages };
      },
      document: async (pageId: string) => repository.readVersionDocument(projectId, versionId, pageId).document,
    });
    const server = createPrototypeMcp(path === '/mcp' ? { forVersion } : forVersion(request.params.projectId!, request.params.versionId!));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      const response = await transport.handleRequest(new Request(origin + request.url, { method: 'POST', headers }), { parsedBody: request.body });
      reply.code(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      return reply.send(Buffer.from(await response.arrayBuffer()));
    } finally { await server.close(); }
  });
  app.route({ method: ['GET', 'DELETE'], url: path, handler: async (_request, reply) => reply.header('Allow', 'POST').code(405).send({ message: '这是 MCP 协议地址，请在 Codex 或 Claude 中连接；不支持浏览器直接打开。' }) });
  }
}
