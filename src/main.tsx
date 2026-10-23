import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import ProjectPreview from './ProjectPreview';
import './style.css';
const Screen = window.location.pathname === '/preview' ? ProjectPreview : App;
createRoot(document.getElementById('root')!).render(<React.StrictMode><ConfigProvider locale={zhCN} button={{ autoInsertSpace: false }} theme={{ token: { colorPrimary: '#635bff', borderRadius: 6, fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif' } }}><AntApp><Screen /></AntApp></ConfigProvider></React.StrictMode>);
