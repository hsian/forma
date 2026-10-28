import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import ProjectPreview from './ProjectPreview';
import { ManagementPage } from './ManagementPage';
import './style.css';
import { AuthGate } from './AuthGate';
import { installApiClient } from './api-client';
installApiClient();
if (window.location.pathname === '/workbench') { const source = new URLSearchParams(window.location.search); const query = new URLSearchParams(); for (const key of ['projectId', 'pageId']) { const value = source.get(key); if (value) query.set(key, value); } window.history.replaceState(null, '', `/${query.size ? '?' + query : ''}`); }
const Screen = window.location.pathname === '/manage' ? ManagementPage : window.location.pathname === '/preview' ? ProjectPreview : App;
createRoot(document.getElementById('root')!).render(<React.StrictMode><ConfigProvider locale={zhCN} button={{ autoInsertSpace: false }} theme={{ token: { colorPrimary: '#635bff', colorText: '#273247', colorTextSecondary: '#4b586e', colorTextTertiary: '#606d82', borderRadius: 6, fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif' } }}><AntApp><AuthGate><Screen /></AuthGate></AntApp></ConfigProvider></React.StrictMode>);
