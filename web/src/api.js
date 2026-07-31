const TOKEN_KEY = 'inventario_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(method, path, body) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload = body;
  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  if (!res.ok) {
    let message = `Erro ${res.status}`;
    try {
      const data = await res.json();
      if (data && data.error) message = data.error;
    } catch (e) {
      // resposta não era JSON
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return res.blob();
}

export const api = {
  auth: {
    login: (username, password) => request('POST', '/auth/login', { username, password }),
    register: (data) => request('POST', '/auth/register', data),
    me: () => request('GET', '/auth/me'),
    changePassword: (currentPassword, newPassword) => request('POST', '/auth/change-password', { currentPassword, newPassword }),
  },
  users: {
    list: () => request('GET', '/users'),
    create: (u) => request('POST', '/users', u),
    update: (id, u) => request('PUT', `/users/${id}`, u),
    remove: (id) => request('DELETE', `/users/${id}`),
  },
  permissions: {
    get: () => request('GET', '/permissions'),
    set: (tabId, role, canView, canEdit) => request('PUT', '/permissions', { tabId, role, canView, canEdit }),
  },
  rawMaterials: {
    list: () => request('GET', '/raw-materials'),
    create: (m) => request('POST', '/raw-materials', m),
    bulkCreate: (items) => request('POST', '/raw-materials/bulk', { items }),
    update: (code, m) => request('PUT', `/raw-materials/${encodeURIComponent(code)}`, m),
    remove: (code) => request('DELETE', `/raw-materials/${encodeURIComponent(code)}`),
  },
  products: {
    list: () => request('GET', '/products'),
    get: (code) => request('GET', `/products/${encodeURIComponent(code)}`),
    create: (p) => request('POST', '/products', p),
    update: (code, p) => request('PUT', `/products/${encodeURIComponent(code)}`, p),
    remove: (code) => request('DELETE', `/products/${encodeURIComponent(code)}`),
  },
  productMaterials: {
    list: () => request('GET', '/product-materials'),
  },
  blends: {
    list: () => request('GET', '/blends'),
    create: (b) => request('POST', '/blends', b),
    update: (id, b) => request('PUT', `/blends/${id}`, b),
    remove: (id) => request('DELETE', `/blends/${id}`),
  },
  contagens: {
    list: () => request('GET', '/contagens'),
    get: (id) => request('GET', `/contagens/${id}`),
    create: (c) => request('POST', '/contagens', c),
    update: (id, c) => request('PUT', `/contagens/${id}`, c),
    remove: (id) => request('DELETE', `/contagens/${id}`),
    setItem: (id, code, patch) => request('PUT', `/contagens/${id}/itens/${encodeURIComponent(code)}`, patch),
    lancamentos: (id, code) => request('GET', `/contagens/${id}/itens/${encodeURIComponent(code)}/lancamentos`),
    addLancamento: (id, code, valor) => request('POST', `/contagens/${id}/itens/${encodeURIComponent(code)}/lancamentos`, { valor }),
    removeLancamento: (id, code, lancamentoId) => request('DELETE', `/contagens/${id}/itens/${encodeURIComponent(code)}/lancamentos/${lancamentoId}`),
    // Matéria Prima Processada e Explosão, por contagem (snapshot do período):
    productStock: {
      list: (contagemId) => request('GET', `/contagens/${contagemId}/product-stock`),
      set: (contagemId, code, quantidade) => request('PUT', `/contagens/${contagemId}/product-stock/${encodeURIComponent(code)}`, { quantidade }),
    },
    virginStock: {
      list: (contagemId) => request('GET', `/contagens/${contagemId}/virgin-stock`),
      set: (contagemId, code, quantidade) => request('PUT', `/contagens/${contagemId}/virgin-stock/${encodeURIComponent(code)}`, { quantidade }),
    },
    summary: (contagemId) => request('GET', `/contagens/${contagemId}/summary`),
    blends: {
      list: (contagemId) => request('GET', `/contagens/${contagemId}/blends`),
      setEstado: (contagemId, blendId, estado, quantidade) => request('PUT', `/contagens/${contagemId}/blends/${blendId}/estados/${estado}`, { quantidade }),
    },
    importFile: (id, file) => {
      const form = new FormData();
      form.append('file', file);
      return request('POST', `/contagens/${id}/import`, form);
    },
    importRetry: (id, itens) => request('POST', `/contagens/${id}/import/retry`, { itens }),
    exportXlsx: async (id, filename) => {
      const blob = await request('GET', `/contagens/${id}/export`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'contagem.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  },
};

export { request };
