import { existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { ApplicationProject } from '../shared/application';

const template = fileURLToPath(new URL('../templates/admin/', import.meta.url));
const additions = [
  'AGENTS.md', 'capabilities.json', 'scripts/check-architecture.mjs',
  'docs/architecture.md', 'docs/api-integrations.md', 'docs/scenarios.md', 'docs/endpoint-example.md',
  'src/services/endpoint.ts', 'src/services/README.md', 'src/modules/README.md',
  'src/modules/shared/types.ts', 'src/modules/shared/useQuery.ts', 'src/modules/shared/useMutation.ts',
  'src/components/QueryBoundary.tsx',
];
const normalize = (text: string) => text.replace(/\r\n/g, '\n');

/** Explicit, additive 1.0 -> 1.1 migration. Never called on startup or page sync. */
export function upgradeApplicationTemplate(projectId: string, application: ApplicationProject, options: {
  validate: (directory: string) => void;
  persist: (application: ApplicationProject) => void;
}) {
  if (application.templateId !== 'admin' || !['1.0.0', '1.1.0'].includes(application.templateVersion)) throw Error('不支持的模板升级版本');
  const directory = resolve(application.directory);
  function path(file: string) {
    const result = resolve(directory, file), rel = relative(directory, result);
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw Error('升级路径超出工程目录');
    let cursor = directory;
    if (!lstatSync(cursor).isDirectory() || lstatSync(cursor).isSymbolicLink()) throw Error('工程根目录必须是普通目录');
    for (const [index, part] of rel.split(sep).entries()) {
      cursor = resolve(cursor, part);
      const stat = lstatSync(cursor, { throwIfNoEntry: false });
      if (stat && (stat.isSymbolicLink() || (index < rel.split(sep).length - 1 ? !stat.isDirectory() : !stat.isFile()))) throw Error(`升级路径不是普通文件：${file}`);
    }
    return result;
  }
  const manifestText = readFileSync(path('.forma/project.json'), 'utf8');
  const manifest = JSON.parse(manifestText);
  if (manifest.projectId !== projectId || manifest.templateId !== application.templateId || manifest.templateVersion !== application.templateVersion) throw Error('工程标识或版本不匹配，停止升级');
  if (application.templateVersion === '1.1.0') return { changed: false, backup: null, added: [], warnings: [] };
  const changes = new Map<string, string>();
  const warnings: string[] = [];
  for (const file of additions) {
    const content = readFileSync(resolve(template, file), 'utf8');
    const target = path(file);
    if (!existsSync(target)) changes.set(file, content);
    else if (normalize(readFileSync(target, 'utf8')) !== normalize(content)) {
      if (file === 'AGENTS.md') warnings.push('已有 AGENTS.md 已保留，请维护者合并 docs/architecture.md 的开发约定');
      else throw Error(`升级文件已有自定义内容，已保留，停止升级：${file}`);
    }
  }
  const packageText = readFileSync(path('package.json'), 'utf8');
  const pkg = JSON.parse(packageText);
  if (pkg.scripts != null && (typeof pkg.scripts !== 'object' || Array.isArray(pkg.scripts))) throw Error('package.json scripts 格式无效');
  pkg.scripts = { ...pkg.scripts };
  const commands: Record<string, string> = { 'check:architecture': 'node scripts/check-architecture.mjs', 'check:forma': 'npm run check:architecture && tsc --noEmit' };
  for (const [key, command] of Object.entries(commands)) {
    if (pkg.scripts[key] && pkg.scripts[key] !== command) throw Error(`已有自定义脚本 ${key}，请先处理冲突`);
    pkg.scripts[key] = command;
  }
  if (!pkg.scripts.check) pkg.scripts.check = commands['check:forma'];
  if (pkg.scripts.build === 'tsc --noEmit && vite build') pkg.scripts.build = 'npm run check:forma && vite build';
  else warnings.push('已有构建脚本已保留；请将 npm run check:forma 纳入构建流程');
  changes.set('package.json', JSON.stringify(pkg, null, 2) + '\n');
  changes.set('.forma/project.json', JSON.stringify({ ...manifest, templateVersion: '1.1.0' }, null, 2) + '\n');
  const originals = new Map([...changes].map(([file]) => [file, existsSync(path(file)) ? readFileSync(path(file), 'utf8') : null]));
  const backupName = `.forma/upgrades/1.0.0-to-1.1.0-${Date.now()}-${randomUUID()}.json`;
  const backup = path(backupName);
  mkdirSync(dirname(backup), { recursive: true });
  writeFileSync(backup, JSON.stringify({ projectId, application, originals: Object.fromEntries(originals), warnings }, null, 2) + '\n', { flag: 'wx' });
  const applied: string[] = [];
  try {
    for (const [file, content] of changes) {
      const target = path(file);
      // Detect a concurrent hand edit after preflight instead of overwriting it.
      const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
      if (current !== originals.get(file)) throw Error(`升级期间文件发生变化：${file}`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, { flag: current === null ? 'wx' : 'w' }); applied.push(file);
    }
    options.validate(directory);
    options.persist({ ...application, templateVersion: '1.1.0' });
  } catch (error) {
    for (const file of applied.reverse()) {
      const target = path(file);
      if (!existsSync(target) || readFileSync(target, 'utf8') !== changes.get(file)) continue;
      const original = originals.get(file);
      if (original === null) unlinkSync(target); else writeFileSync(target, original!);
    }
    throw error;
  }
  return { changed: true, backup, added: [...originals].filter(([, value]) => value === null).map(([file]) => file), warnings };
}
