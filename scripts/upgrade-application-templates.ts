import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { upgradeApplicationTemplate } from '../server/application-template-upgrade';
import type { ApplicationProject } from '../shared/application';

const filename = process.argv[2];
if (!filename) throw Error('请明确指定 Forma 数据库路径');
const apply = process.argv.includes('--apply');
const db = new Database(resolve(filename), { fileMustExist: true });
db.pragma('busy_timeout = 5000');
try {
  const projects = db.prepare('SELECT id,name,application FROM projects WHERE application IS NOT NULL').all() as { id: string; name: string; application: string }[];
  for (const project of projects) {
    const application = JSON.parse(project.application) as ApplicationProject;
    if (!apply) { console.log(JSON.stringify({ projectId: project.id, name: project.name, directory: application.directory, version: application.templateVersion, targetVersion: '1.1.0' })); continue; }
    try {
      const result = db.transaction(() => upgradeApplicationTemplate(project.id, application, {
        validate(directory) {
          const require = createRequire(resolve(directory, 'package.json'));
          execFileSync(process.execPath, [resolve(directory, 'scripts/check-architecture.mjs')], { cwd: directory, stdio: 'pipe' });
          execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--project', resolve(directory, 'tsconfig.json')], { cwd: directory, stdio: 'pipe' });
        },
        persist(next) { db.prepare('UPDATE projects SET application = ? WHERE id = ?').run(JSON.stringify(next), project.id); },
      }))();
      console.log(JSON.stringify({ projectId: project.id, name: project.name, ...result }));
    } catch (error) {
      process.exitCode = 1;
      const failure = error as Error & { stdout?: Buffer; stderr?: Buffer };
      console.error(JSON.stringify({ projectId: project.id, error: failure.message, diagnostics: `${failure.stdout || ''}${failure.stderr || ''}` }));
    }
  }
} finally { db.close(); }
