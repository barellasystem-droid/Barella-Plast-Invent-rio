import { SUPPLIERS } from './suppliers.js';

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
    addLancamento: (id, code, valor, tipo) => request('POST', `/contagens/${id}/itens/${encodeURIComponent(code)}/lancamentos`, { valor, tipo }),
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

// Fornecedores genéricos (Colormaq, Cadence, Inplast, Amvox — ver
// web/src/suppliers.js), endpoints próprios (/api/<key>/*), sem nenhuma
// relação com os endpoints da Mondial acima. Uma função só (em vez de bloco
// copiado por fornecedor) que monta o mesmo conjunto de chamadas pra
// qualquer key — api.colormaq.contagens.list(), api.cadence.products.list()
// etc. são todas geradas daqui.
function makeSupplierApi(key) {
  return {
    rawMaterials: {
      list: () => request('GET', `/${key}/raw-materials`),
      create: (m) => request('POST', `/${key}/raw-materials`, m),
      bulkCreate: (items) => request('POST', `/${key}/raw-materials/bulk`, { items }),
      update: (code, m) => request('PUT', `/${key}/raw-materials/${encodeURIComponent(code)}`, m),
      remove: (code) => request('DELETE', `/${key}/raw-materials/${encodeURIComponent(code)}`),
    },
    products: {
      list: () => request('GET', `/${key}/products`),
      get: (code) => request('GET', `/${key}/products/${encodeURIComponent(code)}`),
      create: (p) => request('POST', `/${key}/products`, p),
      update: (code, p) => request('PUT', `/${key}/products/${encodeURIComponent(code)}`, p),
      remove: (code) => request('DELETE', `/${key}/products/${encodeURIComponent(code)}`),
    },
    productMaterials: {
      list: () => request('GET', `/${key}/product-materials`),
    },
    blends: {
      list: () => request('GET', `/${key}/blends`),
    },
    contagens: {
      list: () => request('GET', `/${key}/contagens`),
      get: (id) => request('GET', `/${key}/contagens/${id}`),
      create: (c) => request('POST', `/${key}/contagens`, c),
      update: (id, c) => request('PUT', `/${key}/contagens/${id}`, c),
      remove: (id) => request('DELETE', `/${key}/contagens/${id}`),
      setItem: (id, code, patch) => request('PUT', `/${key}/contagens/${id}/itens/${encodeURIComponent(code)}`, patch),
      materiaisLancamentos: (id, code) => request('GET', `/${key}/contagens/${id}/materiais/${encodeURIComponent(code)}/lancamentos`),
      addMaterialLancamento: (id, code, valor) => request('POST', `/${key}/contagens/${id}/materiais/${encodeURIComponent(code)}/lancamentos`, { valor }),
      removeMaterialLancamento: (id, code, lancamentoId) => request('DELETE', `/${key}/contagens/${id}/materiais/${encodeURIComponent(code)}/lancamentos/${lancamentoId}`),
      produtosLancamentos: (id, code) => request('GET', `/${key}/contagens/${id}/produtos/${encodeURIComponent(code)}/lancamentos`),
      addProdutoLancamento: (id, code, valor) => request('POST', `/${key}/contagens/${id}/produtos/${encodeURIComponent(code)}/lancamentos`, { valor }),
      removeProdutoLancamento: (id, code, lancamentoId) => request('DELETE', `/${key}/contagens/${id}/produtos/${encodeURIComponent(code)}/lancamentos/${lancamentoId}`),
      pecasProduzidas: {
        list: (contagemId) => request('GET', `/${key}/contagens/${contagemId}/pecas-produzidas`),
        set: (contagemId, code, quantidade) => request('PUT', `/${key}/contagens/${contagemId}/pecas-produzidas/${encodeURIComponent(code)}`, { quantidade }),
      },
      summary: (contagemId) => request('GET', `/${key}/contagens/${contagemId}/summary`),
      blends: {
        list: (contagemId) => request('GET', `/${key}/contagens/${contagemId}/blends`),
        setEstado: (contagemId, blendId, estado, quantidade) => request('PUT', `/${key}/contagens/${contagemId}/blends/${blendId}/estados/${estado}`, { quantidade }),
      },
      exportXlsx: async (id, filename) => {
        const blob = await request('GET', `/${key}/contagens/${id}/export`);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `${key}_contagem.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      },
    },
  };
}

for (const s of SUPPLIERS) {
  api[s.key] = makeSupplierApi(s.key);
}

export { request };
