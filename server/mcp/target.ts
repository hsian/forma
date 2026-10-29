export function parsePrototypeLink(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw Error('请提供完整的“查看版本”链接'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/preview' || url.username || url.password) throw Error('请提供原型系统的 /preview 固定版本链接');
  function field(key: string, required = true) {
    const values = url.searchParams.getAll(key);
    if (!values.length && !required) return undefined;
    if (values.length !== 1 || !values[0].trim() || values[0].length > 200) throw Error(`查看版本链接必须包含唯一有效的 ${key}，不能使用草稿或自动选择最新版本`);
    return values[0];
  }
  return { projectId: field('projectId')!, versionId: field('versionId')!, pageId: field('pageId', false) };
}
