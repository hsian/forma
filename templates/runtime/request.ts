export class HttpError extends Error {
  constructor(message: string, public status: number, public data: unknown) { super(message); this.name = 'HttpError'; }
}
export interface RequestConfiguration {
  baseURL?: string;
  timeout?: number;
  getToken?: () => string | undefined | Promise<string | undefined>;
  onUnauthorized?: () => void;
}
export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  params?: Record<string, string | number | boolean | null | undefined>;
  timeout?: number;
  responseType?: 'json' | 'text' | 'blob';
}
export function createRequest(config: RequestConfiguration = {}) {
  return async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    // 接口路径必须相对 baseURL，避免向其他来源意外发送鉴权信息。
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path) || path.includes('\\') || path.split(/[/?#]/).includes('..')) throw Error('接口路径必须相对 API 地址');
    const { body, params, timeout = config.timeout ?? 15000, responseType = 'json', signal, ...init } = options;
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const timer = timeout > 0 ? setTimeout(() => controller.abort(new DOMException('请求超时', 'TimeoutError')), timeout) : undefined;
    try {
      let url = `${(config.baseURL || '').replace(/\/$/, '')}/${path.replace(/^\/+/, '')}`;
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params || {})) if (value != null) query.set(key, String(value));
      if (query.size) url += `${url.includes('?') ? '&' : '?'}${query}`;
      const headers = new Headers(init.headers);
      const token = await config.getToken?.();
      if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
      const nativeBody = body == null || typeof body === 'string' || body instanceof FormData || body instanceof Blob || body instanceof URLSearchParams || body instanceof ArrayBuffer || ArrayBuffer.isView(body) || body instanceof ReadableStream;
      if (!nativeBody && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      const response = await fetch(url, { credentials: 'same-origin', ...init, headers, body: body == null ? undefined : nativeBody ? body as BodyInit : JSON.stringify(body), signal: controller.signal });
      if (!response.ok) {
        const raw = await response.text();
        let data: unknown = raw;
        try { data = JSON.parse(raw); } catch { /* 非 JSON 错误响应保留原文。 */ }
        if (response.status === 401) config.onUnauthorized?.();
        const message = typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string' ? data.message : `请求失败（${response.status}）`;
        throw new HttpError(message, response.status, data);
      }
      if (response.status === 204 || init.method?.toUpperCase() === 'HEAD') return undefined as T;
      if (responseType === 'blob') return await response.blob() as T;
      const text = await response.text();
      return (responseType === 'text' ? text : text ? JSON.parse(text) : undefined) as T;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
}
