import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { upgradeApplicationTemplate } from '../server/application-template-upgrade';
import type { ApplicationProject } from '../shared/application';

function fixture() {
  mkdirSync('test-results', { recursive: true });
  const directory = mkdtempSync(resolve('test-results/template-upgrade-'));
  mkdirSync(resolve(directory, '.forma'));
  mkdirSync(resolve(directory, 'src/services'), { recursive: true });
  const application: ApplicationProject = { templateId: 'admin', templateVersion: '1.0.0', directoryName: 'legacy', directory, createdAt: 1, syncedAt: 1 };
  writeFileSync(resolve(directory, '.forma/project.json'), JSON.stringify({ projectId: 'legacy', templateId: 'admin', templateVersion: '1.0.0', createdAt: 1 }));
  writeFileSync(resolve(directory, 'package.json'), JSON.stringify({ name: 'custom-name', dependencies: { react: '19.0.0' }, scripts: { dev: 'custom dev', build: 'tsc --noEmit && vite build' } }));
  writeFileSync(resolve(directory, 'src/services/request.ts'), '// custom authentication must survive\nexport const request = 1;');
  return { directory, application };
}
test('旧工程增量升级、保留请求与依赖、自定义脚本、备份、版本更新和重复执行', () => {
  const f = fixture(); let updated: ApplicationProject | undefined;
  const result = upgradeApplicationTemplate('legacy', f.application, { validate: directory => assert.ok(existsSync(resolve(directory, 'capabilities.json'))), persist: value => { updated = value; } });
  assert.equal(updated?.templateVersion, '1.1.0');
  assert.ok(result.backup && existsSync(result.backup));
  assert.match(readFileSync(resolve(f.directory, 'src/services/request.ts'), 'utf8'), /custom authentication/);
  const pkg = JSON.parse(readFileSync(resolve(f.directory, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.dev, 'custom dev'); assert.deepEqual(pkg.dependencies, { react: '19.0.0' });
  assert.equal(pkg.scripts.build, 'npm run check:forma && vite build');
  assert.ok(result.added.includes('src/modules/shared/useMutation.ts'));
  assert.equal(upgradeApplicationTemplate('legacy', updated!, { validate: () => assert.fail(), persist: () => assert.fail() }).changed, false);
});
test('升级遇到自定义同名文件提前停止，验证或数据库更新失败恢复原文件', () => {
  const conflict = fixture();
  writeFileSync(resolve(conflict.directory, 'capabilities.json'), 'custom');
  assert.throws(() => upgradeApplicationTemplate('legacy', conflict.application, { validate() {}, persist() {} }), /自定义内容/);
  assert.equal(existsSync(resolve(conflict.directory, 'scripts/check-architecture.mjs')), false);
  for (const stage of ['validate', 'persist']) {
    const f = fixture(); const before = readFileSync(resolve(f.directory, 'package.json'), 'utf8');
    assert.throws(() => upgradeApplicationTemplate('legacy', f.application, { validate() { if (stage === 'validate') throw Error('failed'); }, persist() { throw Error('failed'); } }), /failed/);
    assert.equal(readFileSync(resolve(f.directory, 'package.json'), 'utf8'), before);
    assert.equal(JSON.parse(readFileSync(resolve(f.directory, '.forma/project.json'), 'utf8')).templateVersion, '1.0.0');
    assert.equal(existsSync(resolve(f.directory, 'capabilities.json')), false);
  }
});
