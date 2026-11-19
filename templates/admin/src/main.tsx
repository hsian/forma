import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { Application } from './Application';
import { appConfig } from './config/app';
import './style.css';
import '../.forma/runtime/src/antd-components.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ConfigProvider locale={zhCN} theme={{ token: appConfig.theme }} button={{ autoInsertSpace: false }}><App><Application/></App></ConfigProvider></React.StrictMode>,
);
