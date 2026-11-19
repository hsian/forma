import { createRequest } from '../../.forma/runtime/request';
import { appConfig } from '../config/app';
export type { RequestOptions } from '../../.forma/runtime/request';

// 业务接口统一使用此实例。可在这里接入真实后台的 token 与登录失效处理。
// 默认同源 Cookie；Forma 的登录会话不会导出到业务工程。
export const request = createRequest({
  baseURL: appConfig.apiBaseURL,
  timeout: appConfig.requestTimeout,
});
