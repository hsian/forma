import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GeneratedPageSource } from '../shared/application.js';
import { ManagementError, type createRepository } from './db/repository.js';

type Snapshot = ReturnType<ReturnType<typeof createRepository>['applicationSnapshot']>;
interface SourceManifest { version: 1; files: Record<string, string> }
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const hash = (text: string) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
const serialize = (data: unknown) => JSON.stringify(data, null, 2) + '\n';
const managedSource = (path: string) => /^src\/pages\/generated\/[\p{L}\p{N}_. -]+\.tsx$/u.test(path);

function pageFile(name: string, id: string) {
  const label = name.normalize('NFKC').replace(/[^\p{L}\p{N}_. -]/gu, '-').trim().replace(/[. ]+$/g, '').slice(0, 40) || '页面';
  return `src/pages/generated/Page-${label}-${hash(id).slice(0, 12)}.tsx`;
}

/** Only generated modules are managed; custom components, services and extensions are never rewritten. */
export function publishApplicationSources(snapshot: Snapshot, directory: string, syncedAt: number) {
  function safePath(file: string) {
    const absolute = resolve(directory, file);
    const rel = relative(directory, absolute);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new ManagementError('生成文件不能超出工程目录', 409);
    let cursor = directory;
    const parts = rel.split(sep);
    for (const [index, part] of parts.entries()) {
      cursor = resolve(cursor, part);
      const stat = lstatSync(cursor, { throwIfNoEntry: false });
      if (!stat) continue;
      if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw new ManagementError(`生成路径不是普通文件或目录：${file}`, 409);
    }
    return absolute;
  }
  const manifestFile = '.forma/generated-files.json';
  const manifestPath = safePath(manifestFile);
  let previous: SourceManifest = { version: 1, files: {} };
  if (existsSync(manifestPath)) {
    try {
      previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (previous.version !== 1 || !previous.files || typeof previous.files !== 'object' || Array.isArray(previous.files) || Object.entries(previous.files).some(([file, digest]) => !managedSource(file) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest))) throw Error('invalid manifest');
    } catch { throw new ManagementError('工程生成记录损坏，请恢复 .forma/generated-files.json 后重试', 409); }
  }
  const generated = new Map<string, string>();
  const sourceFiles: GeneratedPageSource[] = snapshot.pages.map(page => ({ pageId: page.id, name: page.name, file: pageFile(page.name, page.id), revision: page.revision }));
  for (const page of snapshot.pages) {
    const file = sourceFiles.find(item => item.pageId === page.id)!.file;
    generated.set(file, [
      '// Forma 自动生成的 React 页面。修改前查阅 capabilities.json 与 docs/architecture.md；业务编排放 modules，接口适配放 services，手写扩展放 extensions。',
      'import { PrototypePlayer } from "../../../.forma/runtime/src/PrototypePlayer";',
      'import type { PrototypeDocument } from "../../../.forma/runtime/shared/model";',
      '',
      `export const pageInfo = ${serialize({ id: page.id, name: page.name, revision: page.revision }).trim()} as const;`,
      '',
      `export const pageDocument: PrototypeDocument = ${serialize(page.document).trim()};`,
      '',
      `export default function Page_${hash(page.id).slice(0, 12)}() {`,
      '  return <PrototypePlayer doc={pageDocument}/>;',
      '}', '',
    ].join('\n'));
  }
  const routes = [
    '// Forma 自动维护的页面路由，业务扩展请放在 src/extensions。',
    'import { lazy, type ComponentType } from "react";',
    'export interface GeneratedPageRoute { id: string; name: string; parentId: string | null; position: number; revision: number; background: string; sourceFile: string; Component: ComponentType }',
    `export const generatedProject = ${serialize({ id: snapshot.project.id, name: snapshot.project.name }).trim()};`,
    'export const generatedPages: GeneratedPageRoute[] = [',
    ...snapshot.pages.map(page => {
      const file = sourceFiles.find(item => item.pageId === page.id)!.file;
      return `  { ...${JSON.stringify({ id: page.id, name: page.name, parentId: page.parentId, position: page.position, revision: page.revision, background: page.document.background, sourceFile: file })}, Component: lazy(() => import(${JSON.stringify('./' + file.split('/').at(-1)!.replace(/\.tsx$/, ''))})) },`;
    }),
    '];', '',
  ].join('\n');
  generated.set('src/pages/generated/routes.tsx', routes);

  // Preflight every generated file, including removed pages, before changing any file.
  for (const file of new Set([...Object.keys(previous.files), ...generated.keys()])) {
    const path = safePath(file);
    if (!existsSync(path)) continue;
    const current = readFileSync(path, 'utf8');
    if (hash(current) === previous.files[file] || current === generated.get(file)) continue;
    throw new ManagementError(`生成文件有手写修改，已保留：${file}。请将修改移到 src/extensions 或公共组件后重试同步。`, 409);
  }
  const entryFile = 'src/Application.tsx';
  const entry = readFileSync(safePath(entryFile), 'utf8');
  const legacyEntry = readFileSync(resolve(sourceRoot, 'templates/migrations/admin-v1/Application.tsx'), 'utf8');
  const previousEntry = readFileSync(resolve(sourceRoot, 'templates/migrations/admin-v2/Application.tsx'), 'utf8');
  const newEntry = readFileSync(resolve(sourceRoot, 'templates/admin/src/Application.tsx'), 'utf8');
  const normalize = (text: string) => text.replace(/\r\n/g, '\n').trim();
  // Early generated-route templates used a simpler page key and effect dependency list.
  // Enumerate only those shipped variants; preserve every other custom entry verbatim.
  const previousVariants = [previousEntry, previousEntry.replace('[pageId, pages]', '[pageId]')]
    .flatMap(known => [known, known.replace('key={`${page.id}:${page.revision}`}', 'key={page.id}')]);
  const migrateEntry = [legacyEntry, ...previousVariants].some(known => normalize(entry) === normalize(known));
  const customLegacyFrame = !migrateEntry && entry.includes('className="business-app"') && !entry.includes('showAdminLayout');
  const warning = customLegacyFrame ? '应用入口包含自定义修改和旧版导航框架，已保留。请维护者检查 src/Application.tsx 的布局，设计页面默认应独立展示。' : migrateEntry || entry.includes('./pages/generated/routes') ? null : '应用入口包含自定义修改，已保留。页面源码已生成；请维护者将 src/pages/generated/routes 接入自定义应用入口。';

  const plans = new Map(generated);
  plans.set('.forma/snapshot.json', serialize({ schemaVersion: 1, syncedAt, project: { id: snapshot.project.id, name: snapshot.project.name }, pages: snapshot.pages.map(page => ({ id: page.id, name: page.name, parentId: page.parentId, position: page.position, revision: page.revision, document: page.document })) }));
  if (migrateEntry) plans.set(entryFile, newEntry);
  plans.set(manifestFile, serialize({ version: 1, files: Object.fromEntries([...generated].map(([file, text]) => [file, hash(text)])) } satisfies SourceManifest));
  const removals = Object.keys(previous.files).filter(file => !generated.has(file));
  const originals = new Map<string, string | null>();
  for (const file of [...plans.keys(), ...removals]) {
    const path = safePath(file);
    originals.set(file, existsSync(path) ? readFileSync(path, 'utf8') : null);
  }
  function replace(file: string, text: string) {
    const path = safePath(file);
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { writeFileSync(temporary, text, { flag: 'wx' }); renameSync(temporary, path); }
    finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  const changed: string[] = [];
  try {
    for (const [file, text] of plans) {
      if (originals.get(file) === text) continue;
      changed.push(file); replace(file, text);
    }
    for (const file of removals) if (originals.get(file) !== null) { changed.push(file); unlinkSync(safePath(file)); }
  } catch (error) {
    const failedRollbacks: string[] = [];
    for (const file of changed.reverse()) {
      try {
        const original = originals.get(file)!;
        if (original !== null) replace(file, original);
        else if (existsSync(safePath(file))) unlinkSync(safePath(file));
      } catch { failedRollbacks.push(file); }
    }
    throw new ManagementError(`工程写入失败，页面已保存在 Forma 中，请检查目录权限或占用后重试。${failedRollbacks.length ? `这些文件未能恢复，请维护者检查：${failedRollbacks.join('、')}` : ''}`, 503);
  }
  return { sourceFiles, warning };
}
