// One identifier per loaded browser tab; it is not shared through localStorage.
export const editorClientId = crypto.randomUUID();
export function installApiClient() {
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    const local = url.origin === window.location.origin && url.pathname.startsWith('/api/');
    if (local) {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      headers.set('X-Forma-Client-Id', editorClientId);
      init = { ...init, headers };
    }
    const response = await original(input, init);
    if (local && response.status === 401 && !url.pathname.startsWith('/api/auth/')) window.dispatchEvent(new Event('forma:unauthorized'));
    return response;
  };
}
