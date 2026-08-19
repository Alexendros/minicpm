const API = '/api';

function qs(params = {}) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    s.set(k, v);
  }
  const q = s.toString();
  return q ? '?' + q : '';
}

async function parseError(res) {
  let detail = res.statusText || `HTTP ${res.status}`;
  try {
    const j = await res.json();
    if (typeof j.detail === 'string') {
      detail = j.detail;
    } else if (Array.isArray(j.detail)) {
      detail = j.detail.map((d) => d.msg).filter(Boolean).join('; ') || detail;
    }
  } catch {
    /* sin cuerpo JSON */
  }
  const err = new Error(detail);
  err.status = res.status;
  return err;
}

async function request(path, { method = 'GET', body, timeout = 15000, signal } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(API + path, {
      method,
      headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw await parseError(res);
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function readSse(stream, onData) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx = buf.indexOf('\n\n');
    while (idx !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of raw.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          onData(JSON.parse(data));
        } catch {
          /* chunk SSE ilegible */
        }
      }
      idx = buf.indexOf('\n\n');
    }
  }
}

async function streamChat(payload, { signal, onEvent } = {}) {
  const res = await fetch(API + '/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) throw await parseError(res);
  await readSse(res.body, (j) => {
    const d = j.choices?.[0]?.delta;
    if (d?.content) onEvent?.({ type: 'delta', content: d.content });
    if (d?.reasoning_content) onEvent?.({ type: 'reasoning', content: d.reasoning_content });
  });
  onEvent?.({ type: 'done' });
}

async function streamRag(payload, { signal, onEvent } = {}) {
  const res = await fetch(API + '/rag', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) throw await parseError(res);
  await readSse(res.body, (j) => onEvent?.(j));
}

export const api = {
  get: (path, params) => request(path + qs(params)),
  post: (path, body, opts) => request(path, { method: 'POST', body, ...opts }),
  postForm: (path, formData, opts) => request(path, { method: 'POST', body: formData, ...opts }),
  del: (path, opts) => request(path, { method: 'DELETE', ...opts }),
  streamChat,
  streamRag,
  services: {
    list: () => request('/services'),
    start: (name, timeout = 60000) => request(`/services/${name}/start`, { method: 'POST', body: {}, timeout }),
    stop: (name, timeout = 60000) => request(`/services/${name}/stop`, { method: 'POST', body: {}, timeout }),
    logs: (name) => request(`/logs/${name}`),
    meta: () => request('/meta'),
    host: () => request('/host'),
    gpu: () => request('/gpu'),
    getSlot: () => request('/slot'),
    setSlot: (body) => request('/slot', { method: 'POST', body }),
  },
  sessions: {
    list: () => request('/sessions'),
    create: (name) => request('/sessions', { method: 'POST', body: name ? { name } : {} }),
    get: (id) => request(`/sessions/${id}`),
    del: (id) => request(`/sessions/${id}`, { method: 'DELETE' }),
  },
  kb: {
    documents: () => request('/documents'),
    upload: (file) => {
      const fd = new FormData();
      fd.append('file', file);
      return request('/documents', { method: 'POST', body: fd, timeout: 120000 });
    },
    deleteDocument: (id) => request(`/documents/${id}`, { method: 'DELETE' }),
    search: (query, opts = {}) =>
      request(`/search${qs({ query, ...opts })}`),
  },
  mail: {
    status: () => request('/mail/status'),
    config: (body) => request('/mail/config', { method: 'POST', body }),
    folders: () => request('/mail/folders'),
    unread: (opts = {}) => request(`/mail/unread${qs(opts)}`),
    search: (opts = {}) => request(`/mail/search${qs(opts)}`),
    fetch: (uid, folder) => request(`/mail/fetch${qs({ uid, folder })}`),
    attachmentUrl: (uid, part, folder) =>
      `${API}/mail/attachment${qs({ uid, part, folder })}`,
    mark: (body) => request('/mail/mark', { method: 'POST', body }),
    send: (body) => request('/mail/send', { method: 'POST', body }),
  },
};