import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicationTemplates, type ApplicationProject } from '../shared/application.js';
import { ManagementError, type createRepository } from './db/repository.js';
import { isProduction } from './db/config.js';
import { publishApplicationSources } from './application-codegen.js';

type Snapshot = ReturnType<ReturnType<typeof createRepository>['applicationSnapshot']>;
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
// 共享运行器只复制运行时依赖，不包含编辑器、账号或服务端代码。
const runtimeFiles = [
  'src/PrototypePlayer.tsx', 'src/ElementView.tsx', 'src/AntdElement.tsx', 'src/ChoiceView.tsx',
  'src/DrawingView.tsx', 'src/RichText.tsx', 'src/Annotations.tsx',
  'src/annotations.css', 'src/antd-components.css', 'src/table-appearance.css', 'src/runtime-base.css',
  'shared/model.ts', 'shared/runtime.ts', 'shared/annotations.ts', 'shared/drawing.ts',
  'shared/vector.ts', 'shared/uuid.ts', 'shared/antd-catalog.ts', 'shared/table-layout.ts',
];

export function createApplicationWorkspace(options: { rootDirectory?: string } = {}) {
  const rootDirectory = resolve(options.rootDirectory || process.env.FORMA_PROJECTS_ROOT || resolve(sourceRoot, 'data', 'applications', isProduction() ? 'production' : 'development'));
  const setup = () => ({ rootDirectory, templates: applicationTemplates });
  function parentPath(requested = rootDirectory, nativeSelection = false) {
    if (nativeSelection) {
      if (!isAbsolute(requested)) throw new ManagementError('请选择有效的本地目录');
      try {
        const path = realpathSync(requested);
        if (!lstatSync(path).isDirectory()) throw Error('not a directory');
        return path;
      } catch { throw new ManagementError('所选目录不存在或无法访问，请重新选择'); }
    }
    const path = resolve(requested);
    const rel = relative(rootDirectory, path);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new ManagementError('请选择工程根目录内的文件夹');
    mkdirSync(rootDirectory, { recursive: true });
    try {
      let cursor = rootDirectory;
      for (const segment of rel.split(sep).filter(Boolean)) {
        cursor = resolve(cursor, segment);
        if (lstatSync(cursor).isSymbolicLink()) throw new ManagementError('不能选择符号链接目录');
      }
      if (!lstatSync(path).isDirectory()) throw new ManagementError('请选择有效的文件夹');
    } catch (error) {
      if (error instanceof ManagementError) throw error;
      throw new ManagementError('文件夹不存在或无法访问，请重新选择');
    }
    return path;
  }
  function contained(path: string, parentDirectory = rootDirectory) {
    const rel = relative(parentDirectory, path);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new ManagementError('工程目录必须在配置的项目根目录内');
  }
  function directoryPath(directoryName: string, parentDirectory = rootDirectory) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(directoryName) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:[._-]|$)/i.test(directoryName)) throw new ManagementError('工程目录名需为 1–64 位小写字母、数字、短横线或下划线，且不能使用系统保留名称');
    const directory = resolve(parentDirectory, directoryName);
    contained(directory, parentDirectory);
    return directory;
  }
  function write(path: string, data: string) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data, { flag: 'wx' });
  }
  function json(value: unknown) { return JSON.stringify(value, null, 2) + '\n'; }
  function snapshotData(snapshot: Snapshot, syncedAt: number) {
    return { schemaVersion: 1, syncedAt, project: { id: snapshot.project.id, name: snapshot.project.name }, pages: snapshot.pages.map(page => ({ id: page.id, name: page.name, parentId: page.parentId, position: page.position, revision: page.revision, document: page.document })) };
  }
  function copyTemplate(from: string, to: string) {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (entry.isDirectory()) copyTemplate(resolve(from, entry.name), resolve(to, entry.name));
      else if (entry.isFile()) write(resolve(to, entry.name), readFileSync(resolve(from, entry.name), 'utf8'));
    }
  }
  function create<T>(templateId: string, requestedDirectory: string | undefined, commit: (application: ApplicationProject, initialize: (snapshot: Snapshot) => void) => T, requestedParent?: string, nativeSelection = false): T {
    const template = applicationTemplates.find(item => item.id === templateId && item.available);
    if (!template?.version) throw new ManagementError('所选模板暂未开放，请选择管理后台');
    const directoryName = requestedDirectory || `app-${randomUUID().slice(0, 12)}`;
    const parentDirectory = parentPath(requestedParent, nativeSelection);
    const directory = directoryPath(directoryName, parentDirectory);
    // 不复用已有目录，即使它是空目录；避免覆盖已有工程或符号链接。
    try { mkdirSync(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ManagementError('工程目录已存在，请更换目录名', 409); throw new ManagementError('无法创建工程目录，请检查服务器目录权限'); }
    const ownedDirectory = realpathSync(directory);
    const now = Date.now();
    const application: ApplicationProject = { templateId: 'admin', templateVersion: template.version, directoryName, directory, parentDirectory, ...(nativeSelection ? { directorySelection: 'native' as const } : {}), createdAt: now, syncedAt: now };
    try {
      let initialized = false;
      const result = commit(application, snapshot => {
        if (initialized) throw Error('工程不能重复初始化');
        copyTemplate(resolve(sourceRoot, 'templates/admin'), directory);
        const rootPackage = JSON.parse(readFileSync(resolve(sourceRoot, 'package.json'), 'utf8'));
        const templatePackage = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
        const lock = JSON.parse(readFileSync(resolve(sourceRoot, 'package-lock.json'), 'utf8'));
        const version = (name: string) => lock.packages[`node_modules/${name}`]?.version || rootPackage.dependencies[name] || rootPackage.devDependencies[name];
        const dependencies = Object.fromEntries(['react', 'react-dom', 'antd', '@ant-design/icons', 'dayjs'].map(name => [name, version(name)]));
        const devDependencies = Object.fromEntries(['typescript', 'vite', '@vitejs/plugin-react', '@types/react', '@types/react-dom', '@types/node'].map(name => [name, version(name)]));
        writeFileSync(resolve(directory, 'package.json'), json({ ...templatePackage, name: `forma-${directoryName}`, dependencies, devDependencies }));
        for (const file of runtimeFiles) write(resolve(directory, '.forma/runtime', file), readFileSync(resolve(sourceRoot, file), 'utf8'));
        write(resolve(directory, '.forma/runtime/request.ts'), readFileSync(resolve(sourceRoot, 'templates/runtime/request.ts'), 'utf8'));
        write(resolve(directory, '.forma/project.json'), json({ schemaVersion: 1, projectId: snapshot.project.id, templateId, templateVersion: template.version, createdAt: now }));
        write(resolve(directory, '.forma/snapshot.json'), json(snapshotData(snapshot, now)));
        publishApplicationSources(snapshot, directory, now);
        initialized = true;
      });
      if (!initialized) throw Error('工程初始化未完成');
      return result;
    } catch (error) {
      // 仅清理本次独占创建且身份未变化的目录，数据库由调用方事务回滚。
      contained(directory, parentDirectory);
      if (existsSync(directory) && !lstatSync(directory).isSymbolicLink() && realpathSync(directory) === ownedDirectory) rmSync(directory, { recursive: true });
      throw error;
    }
  }
  function sync(snapshot: Snapshot) {
    const application = snapshot.project.application;
    if (!application) throw new ManagementError('此项目为原型项目，尚未关联业务工程', 409);
    const directory = directoryPath(application.directoryName, parentPath(application.parentDirectory, application.directorySelection === 'native'));
    if (directory !== application.directory) throw new ManagementError('工程根目录已变化，请恢复原目录配置后同步', 409);
    const managed = resolve(directory, '.forma');
    try {
      for (const path of [directory, managed, resolve(managed, 'project.json'), resolve(managed, 'snapshot.json')]) {
        if (lstatSync(path).isSymbolicLink()) throw new ManagementError('工程目录或生成文件不能是符号链接', 409);
      }
      const manifest = JSON.parse(readFileSync(resolve(managed, 'project.json'), 'utf8'));
      if (manifest.projectId !== snapshot.project.id || manifest.templateId !== application.templateId || manifest.templateVersion !== application.templateVersion) throw new ManagementError('工程标识或模板版本不匹配，请检查关联目录', 409);
    } catch (error) {
      if (error instanceof ManagementError) throw error;
      throw new ManagementError('工程目录丢失或工程标识损坏，请检查服务器上的存放位置', 409);
    }
    const syncedAt = Date.now();
    return { syncedAt, ...publishApplicationSources(snapshot, directory, syncedAt) };
  }
  return { setup, create, sync };
}
