import { Suspense, useEffect, useState } from 'react';
import { Alert, Button, Layout, Menu, Spin, Typography } from 'antd';
import { generatedPages as pages, generatedProject } from './pages/generated/routes';
import { appConfig } from './config/app';
import { pageOverrides } from './extensions';

const { Header, Sider, Content } = Layout;
function requestedPage() {
  const id = new URLSearchParams(location.hash.slice(1)).get('page');
  return pages.some(page => page.id === id) ? id! : pages[0]?.id || '';
}
function items(parentId: string | null): { key: string; label: string; children?: ReturnType<typeof items> }[] {
  return pages.filter(page => page.parentId === parentId).map(page => {
    const children = items(page.id);
    // 父页面自身也可以访问。
    return { key: page.id, label: page.name, ...(children.length ? { children: [{ key: `${page.id}:self`, label: `${page.name} · 概览` }, ...children] } : {}) };
  });
}
export function Application() {
  const [pageId, setPageId] = useState(requestedPage);
  const [collapsed, setCollapsed] = useState(false);
  const page = pages.find(item => item.id === pageId);
  const ActivePage = page?.Component;
  const title = appConfig.title || generatedProject.name;
  useEffect(() => { if (!pages.some(item => item.id === pageId)) setPageId(requestedPage()); }, [pageId, pages]);
  useEffect(() => { const changed = () => setPageId(requestedPage()); window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed); }, []);
  useEffect(() => { document.title = `${page?.name || '首页'} · ${title}`; }, [page?.name, title]);
  return <Layout className="business-app">
    <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} breakpoint="lg" theme="light" width={224}>
      <div className="business-brand" title={title}>{collapsed ? title.slice(0, 1) : title}</div>
      <Menu mode="inline" items={items(null)} selectedKeys={[pageId, `${pageId}:self`]} defaultOpenKeys={pages.filter(item => pages.some(child => child.parentId === item.id)).map(item => item.id)} onClick={({ key }) => { location.hash = new URLSearchParams({ page: key.replace(/:self$/, '') }).toString(); }}/>
    </Sider>
    <Layout><Header className="business-header"><Typography.Text strong>{page?.name || title}</Typography.Text><Button size="small" onClick={() => setCollapsed(value => !value)}>切换导航</Button></Header>
      <Content className="business-content"><Suspense fallback={<Spin tip="正在加载页面"/>}>{page && ActivePage ? pageOverrides[page.id] ?? <ActivePage key={`${page.id}:${page.revision}`}/> : <Alert type="info" message="暂无页面，请在 Forma 中新增页面"/>}</Suspense></Content>
    </Layout>
  </Layout>;
}
