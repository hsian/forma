// 开发者维护；Forma 同步页面时保留此文件。
export const appConfig = {
  title: '', // 留空时使用 Forma 项目名称。
  layout: 'page' as 'page' | 'admin', // 默认忠实呈现设计；需要模板导航时由维护者显式改为 admin。
  apiBaseURL: import.meta.env?.VITE_API_BASE_URL || '/api',
  requestTimeout: 15000,
  theme: { colorPrimary: '#635bff', borderRadius: 6 },
};
