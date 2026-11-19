import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const allowed = {
  config: ['config', 'utils'], utils: ['utils'], components: ['components', 'utils'],
  services: ['services', 'config', 'utils'], modules: ['modules', 'services', 'components', 'utils', 'config'],
  pages: ['pages', 'modules', 'services', 'components', 'utils', 'config'],
  extensions: ['extensions', 'pages', 'modules', 'services', 'components', 'utils', 'config'],
};
export function checkArchitecture(root = process.cwd()) {
  const errors = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) { errors.push(`${relative(root, absolute)}: 源码目录不允许符号链接`); continue; }
      if (entry.isDirectory()) { walk(absolute); continue; }
      if (!/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      const file = relative(root, absolute).split(sep).join('/');
      const parts = file.split('/'), layer = parts[1];
      const source = ts.createSourceFile(file, readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true);
      function report(node, message) { errors.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${message}`); }
      function dependency(node, specifier) {
        if (!specifier.startsWith('.')) return; // package imports are governed by package.json
        const target = relative(root, resolve(dirname(absolute), specifier)).split(sep).join('/');
        if (target.startsWith('.forma/runtime/') && (file.startsWith('src/pages/generated/') || file === 'src/services/request.ts')) return;
        if (file === 'src/services/endpoint.ts' && target === '.forma/runtime/request' && ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) return;
        const targetParts = target.split('/'), targetLayer = targetParts[1];
        if (allowed[layer] && (targetParts[0] !== 'src' || !allowed[layer].includes(targetLayer))) report(node, `${layer} 不能依赖 ${target}；请按分层移动公共能力`);
        if (layer === 'modules' && targetLayer === 'modules' && parts[2] !== targetParts[2] && targetParts[2] !== 'shared') report(node, '业务模块不能直接引用其他业务域；请提取稳定的共享能力');
      }
      function visit(node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) dependency(node, node.moduleSpecifier.text);
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          if ((callee.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(callee) && callee.text === 'require') && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) dependency(node, node.arguments[0].text);
          if ((ts.isIdentifier(callee) && callee.text === 'fetch' || ts.isPropertyAccessExpression(callee) && ['window', 'globalThis'].includes(callee.expression.getText(source)) && callee.name.text === 'fetch') && file !== 'src/services/request.ts') report(node, '请复用 services/request，不在页面或模块中直接 fetch');
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  walk(resolve(root, 'src'));
  return errors;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkArchitecture();
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('工程分层检查通过');
}
