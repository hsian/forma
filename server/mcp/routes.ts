import type { FastifyInstance } from 'fastify';
import type { createRepository } from '../db/repository.js';
import { VersionError } from '../db/versions.js';

// Only these two fixed-version GET routes are anonymous. Never exempt the whole prefix.
export function isPublicMcpRead(method: string, path: string) {
  return ['GET', 'HEAD'].includes(method) && /^\/api\/mcp\/projects\/[^/]+\/versions\/[^/]+(?:\/pages\/[^/]+)?$/.test(path);
}

export function registerPrototypeMcpReads(app: FastifyInstance, repository: ReturnType<typeof createRepository>) {
  function read<T>(operation: () => T, reply: import('fastify').FastifyReply) {
    try { return operation(); }
    catch (error) {
      if (error instanceof VersionError) return reply.code(error.statusCode).send({ message: error.message });
      throw error;
    }
  }
  app.get<{ Params: { projectId: string; versionId: string } }>('/api/mcp/projects/:projectId/versions/:versionId', async (request, reply) => read(() => {
    const { project, version, pages } = repository.readVersion(request.params.projectId, request.params.versionId);
    return { project, version: { id: version.id, name: version.name, description: version.description, createdAt: version.createdAt }, pages };
  }, reply));
  app.get<{ Params: { projectId: string; versionId: string; snapshotPageId: string } }>('/api/mcp/projects/:projectId/versions/:versionId/pages/:snapshotPageId', async (request, reply) => read(() => repository.readVersionDocument(request.params.projectId, request.params.versionId, request.params.snapshotPageId), reply));
}
