import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import ProjectPreview from './ProjectPreview';
import type { OfflineVersion } from '../shared/offline-version';
import './style.css';

const snapshot: OfflineVersion = JSON.parse(document.getElementById('forma-offline-data')!.textContent!);
createRoot(document.getElementById('root')!).render(<React.StrictMode><ConfigProvider locale={zhCN} button={{ autoInsertSpace: false }} theme={{ token: { colorPrimary: '#635bff', colorText: '#273247', colorTextSecondary: '#4b586e', colorTextTertiary: '#606d82', borderRadius: 6, fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif' } }}><App><ProjectPreview offline={snapshot}/></App></ConfigProvider></React.StrictMode>);
