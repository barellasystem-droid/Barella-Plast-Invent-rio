import React, { useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken } from './api.js';
import { styles, colors, GlobalStyle } from './styles.jsx';
import { NAV_ITEMS, NAV_GROUPS, ESTADOS, ESTADO_LABELS, UNIDADES, ROLES, ROLE_LABELS, STATUS_LABELS, statusTone, condicaoTone, formatNumber, formatPercent, formatDate, hojeBrasilia } from './constants.js';

// ---------------------------------------------------------------- shared UI

function Field({ label, children }) {
  return (
    <div>
      <label style={styles.label}>{label}</label>
      {children}
    </div>
  );
}

function Badge({ tone, children }) {
  return <span style={styles.badge(tone)}>{children}</span>;
}

function Banner({ tone = 'default', children, onClose }) {
  const bg = tone === 'danger' ? '#FBE6E4' : tone === 'success' ? '#E4F3E9' : '#FCEFDA';
  const fg = tone === 'danger' ? colors.danger : tone === 'success' ? colors.success : colors.warning;
  return (
    <div style={{ background: bg, color: fg, padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 14, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span>{children}</span>
      {onClose && <button onClick={onClose} style={{ background: 'none', border: 'none', color: fg, cursor: 'pointer', fontWeight: 700 }}>×</button>}
    </div>
  );
}

function useAsyncList(loader, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => {
    loader().then(setData).catch((e) => setError(e.message));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload]);
  return [data, reload, error];
}

// ------------------------------------------------------------------- Login

function LoginForm({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token, user } = await api.auth.login(username, password);
      setToken(token);
      onLogin(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <Banner tone="danger">{error}</Banner>}
      <div style={{ marginBottom: 12 }}>
        <Field label="Usuário">
          <input style={styles.input} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </Field>
      </div>
      <div style={{ marginBottom: 20 }}>
        <Field label="Senha">
          <input style={styles.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      </div>
      <button type="submit" disabled={loading} style={{ ...styles.button('primary'), width: '100%' }}>
        {loading ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  );
}

function RegisterForm({ onRegistered }) {
  const [form, setForm] = useState({ name: '', username: '', password: '', confirmPassword: '', email: '', phone: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirmPassword) {
      setError('As senhas não conferem.');
      return;
    }
    if (form.password.length < 8) {
      setError('A senha precisa ter no mínimo 8 caracteres.');
      return;
    }
    setLoading(true);
    try {
      await api.auth.register(form);
      onRegistered();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <Banner tone="danger">{error}</Banner>}
      <div style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
        <Field label="Nome completo">
          <input style={styles.input} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Usuário (login)">
          <input style={styles.input} required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </Field>
        <Field label="E-mail (opcional)">
          <input style={styles.input} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Telefone (opcional)">
          <input style={styles.input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="Senha">
          <input style={styles.input} type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Field label="Confirmar senha">
          <input style={styles.input} type="password" required value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} />
        </Field>
      </div>
      <button type="submit" disabled={loading} style={{ ...styles.button('primary'), width: '100%' }}>
        {loading ? 'Enviando...' : 'Criar conta'}
      </button>
    </form>
  );
}

function Login({ onLogin }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'registered'

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.sidebarBg, padding: 20 }}>
      <div style={{ background: colors.surface, padding: 32, borderRadius: 12, width: 360 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 0 }}>Barella Plast</h1>
        <p style={{ color: colors.textMuted, marginTop: -8, marginBottom: 20, fontSize: 13 }}>Sistema de Inventário</p>

        {mode === 'login' && <LoginForm onLogin={onLogin} />}

        {mode === 'register' && <RegisterForm onRegistered={() => setMode('registered')} />}

        {mode === 'registered' && (
          <Banner tone="success">
            Cadastro enviado! Assim que um administrador aprovar seu acesso, você já pode entrar com o login e senha criados.
          </Banner>
        )}

        <div style={{ marginTop: 16, textAlign: 'center', fontSize: 13 }}>
          {mode === 'login' && (
            <button type="button" onClick={() => setMode('register')} style={{ background: 'none', border: 'none', color: colors.accent, cursor: 'pointer', fontWeight: 600 }}>
              Ainda não tenho acesso — criar conta
            </button>
          )}
          {mode !== 'login' && (
            <button type="button" onClick={() => setMode('login')} style={{ background: 'none', border: 'none', color: colors.accent, cursor: 'pointer', fontWeight: 600 }}>
              ← Voltar para o login
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- Cadastros

function RawMaterialForm({ initial, isEdit, onSaved, onCancel }) {
  const [form, setForm] = useState(initial || { code: '', nome: '', unidade: 'KG' });
  const [error, setError] = useState('');
  const originalCode = initial?.code;

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      if (isEdit) await api.rawMaterials.update(originalCode, { code: form.code, nome: form.nome, unidade: form.unidade });
      else await api.rawMaterials.create(form);
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form onSubmit={submit} style={{ ...styles.card, background: '#FAFAFA' }}>
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="bp-form-grid" style={styles.formGrid}>
        <Field label="Código">
          <input style={styles.input} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
        </Field>
        <Field label="Nome">
          <input style={styles.input} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
        </Field>
        <Field label="Unidade">
          <select style={styles.select} value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })}>
            {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button type="submit" style={styles.button('primary')}>Salvar</button>
        {onCancel && <button type="button" style={styles.button('ghost')} onClick={onCancel}>Cancelar</button>}
      </div>
    </form>
  );
}

function RawMaterialsSection({ canEdit, prefill, onRegistered }) {
  const [materials, reload] = useAsyncList(api.rawMaterials.list, []);
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(!!prefill);

  useEffect(() => { if (prefill) setShowNew(true); }, [prefill]);

  return (
    <div>
      {canEdit && !showNew && (
        <button style={styles.button('primary')} onClick={() => setShowNew(true)}>+ Nova matéria-prima</button>
      )}
      {canEdit && showNew && (
        <div style={{ marginTop: 12 }}>
          <RawMaterialForm
            initial={prefill ? { code: prefill.code, nome: prefill.nome || '', unidade: 'KG' } : null}
            isEdit={false}
            onSaved={() => { setShowNew(false); reload(); if (prefill && onRegistered) onRegistered(prefill.code); }}
            onCancel={() => setShowNew(false)}
          />
        </div>
      )}
      {editing && (
        <div style={{ marginTop: 12 }}>
          <RawMaterialForm initial={editing} isEdit onSaved={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />
        </div>
      )}
      <table style={{ ...styles.table, marginTop: 16 }} className="bp-table-scroll">
        <thead><tr><th style={styles.th}>Código</th><th style={styles.th}>Nome</th><th style={styles.th}>Unidade</th>{canEdit && <th style={styles.th}></th>}</tr></thead>
        <tbody>
          {(materials || []).map((m) => (
            <tr key={m.code}>
              <td style={styles.td}>{m.code}</td>
              <td style={styles.td}>{m.nome}</td>
              <td style={styles.td}>{m.unidade}</td>
              {canEdit && (
                <td style={styles.td}>
                  <button style={styles.button('ghost')} onClick={() => setEditing(m)}>Editar</button>{' '}
                  <button style={styles.button('danger')} onClick={async () => { if (confirm(`Excluir ${m.code}?`)) { await api.rawMaterials.remove(m.code); reload(); } }}>Excluir</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProductForm({ code, rawMaterials, onSaved, onCancel }) {
  const isEdit = !!code;
  const [form, setForm] = useState({ code: code || '', nome: '' });
  const [materials, setMaterials] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isEdit) api.products.get(code).then((p) => { setForm({ code: p.code, nome: p.nome }); setMaterials(p.materials || []); });
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  function addRow() { setMaterials([...materials, { rawMaterialCode: '', consumoUnitario: 0 }]); }
  function updateRow(i, patch) { setMaterials(materials.map((m, idx) => (idx === i ? { ...m, ...patch } : m))); }
  function removeRow(i) { setMaterials(materials.filter((_, idx) => idx !== i)); }

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      const payload = { ...form, materials: materials.filter((m) => m.rawMaterialCode) };
      if (isEdit) await api.products.update(code, payload);
      else await api.products.create(payload);
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form onSubmit={submit} style={{ ...styles.card, background: '#FAFAFA' }}>
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="bp-form-grid" style={styles.formGrid}>
        <Field label="Código"><input style={styles.input} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required /></Field>
        <Field label="Nome"><input style={styles.input} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required /></Field>
      </div>
      <h3 style={{ ...styles.h2, marginTop: 16 }}>Consumo de matéria-prima por unidade produzida</h3>
      {materials.map((m, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <select style={styles.select} value={m.rawMaterialCode} onChange={(e) => updateRow(i, { rawMaterialCode: e.target.value })}>
            <option value="">Selecione a matéria-prima</option>
            {(rawMaterials || []).map((rm) => <option key={rm.code} value={rm.code}>{rm.code} — {rm.nome}</option>)}
          </select>
          <input style={{ ...styles.input, width: 160 }} type="number" step="any" placeholder="Consumo/unid." value={m.consumoUnitario} onChange={(e) => updateRow(i, { consumoUnitario: e.target.value })} />
          <button type="button" style={styles.button('danger')} onClick={() => removeRow(i)}>Remover</button>
        </div>
      ))}
      <button type="button" style={styles.button('ghost')} onClick={addRow}>+ Adicionar matéria-prima</button>
      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button type="submit" style={styles.button('primary')}>Salvar</button>
        {onCancel && <button type="button" style={styles.button('ghost')} onClick={onCancel}>Cancelar</button>}
      </div>
    </form>
  );
}

function ProductsSection({ canEdit }) {
  const [products, reload] = useAsyncList(api.products.list, []);
  const [rawMaterials] = useAsyncList(api.rawMaterials.list, []);
  const [editingCode, setEditingCode] = useState(undefined);

  return (
    <div>
      {canEdit && editingCode === undefined && (
        <button style={styles.button('primary')} onClick={() => setEditingCode(null)}>+ Novo produto</button>
      )}
      {canEdit && editingCode !== undefined && (
        <div style={{ marginTop: 12 }}>
          <ProductForm code={editingCode} rawMaterials={rawMaterials} onSaved={() => { setEditingCode(undefined); reload(); }} onCancel={() => setEditingCode(undefined)} />
        </div>
      )}
      <table style={{ ...styles.table, marginTop: 16 }} className="bp-table-scroll">
        <thead><tr><th style={styles.th}>Código</th><th style={styles.th}>Nome</th>{canEdit && <th style={styles.th}></th>}</tr></thead>
        <tbody>
          {(products || []).map((p) => (
            <tr key={p.code}>
              <td style={styles.td}>{p.code}</td>
              <td style={styles.td}>{p.nome}</td>
              {canEdit && (
                <td style={styles.td}>
                  <button style={styles.button('ghost')} onClick={() => setEditingCode(p.code)}>Editar</button>{' '}
                  <button style={styles.button('danger')} onClick={async () => { if (confirm(`Excluir ${p.code}?`)) { await api.products.remove(p.code); reload(); } }}>Excluir</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CadastrosTab({ perms, pendingRegister, onRegistered }) {
  const [sub, setSub] = useState(pendingRegister ? 'materias' : 'produtos');
  useEffect(() => { if (pendingRegister) setSub('materias'); }, [pendingRegister]);
  const canEdit = perms.cadastros?.edit;
  return (
    <div>
      <h1 style={styles.h1}>Cadastros</h1>
      {pendingRegister && (
        <Banner tone="warning">
          Cadastrando matéria-prima pendente da contagem — código <b>{pendingRegister.code}</b>
          {pendingRegister.nome ? <> ({pendingRegister.nome})</> : null}, igual ao arquivo importado. Ao salvar, você volta para a importação.
        </Banner>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button style={styles.button(sub === 'produtos' ? 'primary' : 'ghost')} onClick={() => setSub('produtos')}>Produtos</button>
        <button style={styles.button(sub === 'materias' ? 'primary' : 'ghost')} onClick={() => setSub('materias')}>Matérias-Primas</button>
      </div>
      {sub === 'produtos' && <ProductsSection canEdit={canEdit} />}
      {sub === 'materias' && <RawMaterialsSection canEdit={canEdit} prefill={pendingRegister} onRegistered={onRegistered} />}
    </div>
  );
}

// --------------------------------------------------------------- Explosão

function BlendCard({ blend, rawMaterials, canEdit, podeEditarEstados, contagemId, onChanged }) {
  const [nome, setNome] = useState(blend.nome);
  const [components, setComponents] = useState(blend.components.length ? blend.components : [{ rawMaterialCode: '', percentual: null }]);
  const [estados, setEstados] = useState(blend.estados);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function updateComp(i, patch) { setComponents(components.map((c, idx) => (idx === i ? { ...c, ...patch } : c))); }
  function addComp() { setComponents([...components, { rawMaterialCode: '', percentual: 0 }]); }
  function removeComp(i) { setComponents(components.filter((_, idx) => idx !== i)); }

  async function saveBlend() {
    setSaving(true);
    setError('');
    try {
      const payload = { nome, components: components.filter((c) => c.rawMaterialCode).map((c, idx, arr) => ({ rawMaterialCode: c.rawMaterialCode, percentual: idx === arr.length - 1 ? null : Number(c.percentual) || 0 })) };
      if (blend.id) await api.blends.update(blend.id, payload);
      else { const created = await api.blends.create(payload); blend.id = created.id; }
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveEstado(estado, value) {
    setEstados({ ...estados, [estado]: value });
    if (blend.id && contagemId) await api.contagens.blends.setEstado(contagemId, blend.id, estado, value);
  }

  return (
    <div style={styles.card}>
      {error && <Banner tone="danger">{error}</Banner>}
      <Field label="Nome da mistura">
        <input style={styles.input} value={nome} disabled={!canEdit} onChange={(e) => setNome(e.target.value)} />
      </Field>
      <h3 style={{ ...styles.h2, marginTop: 16 }}>Componentes (percentual do total; o último fica com o restante)</h3>
      {components.map((c, i) => {
        const isLast = i === components.length - 1;
        return (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <select style={styles.select} value={c.rawMaterialCode} disabled={!canEdit} onChange={(e) => updateComp(i, { rawMaterialCode: e.target.value })}>
              <option value="">Selecione a matéria-prima</option>
              {(rawMaterials || []).map((rm) => <option key={rm.code} value={rm.code}>{rm.code} — {rm.nome}</option>)}
            </select>
            {isLast ? (
              <span style={{ width: 140, color: colors.textMuted, fontSize: 13 }}>resto (100% - outros)</span>
            ) : (
              <input style={{ ...styles.input, width: 100 }} type="number" step="any" disabled={!canEdit} placeholder="% do total" value={c.percentual == null ? '' : c.percentual * 100} onChange={(e) => updateComp(i, { percentual: Number(e.target.value) / 100 })} />
            )}
            {canEdit && <button type="button" style={styles.button('danger')} onClick={() => removeComp(i)}>Remover</button>}
          </div>
        );
      })}
      {canEdit && <button type="button" style={styles.button('ghost')} onClick={addComp}>+ Adicionar componente</button>}

      <h3 style={{ ...styles.h2, marginTop: 20 }}>Quantidade lançada por estado</h3>
      <div className="bp-form-grid" style={styles.formGrid}>
        {ESTADOS.map((e) => (
          <Field key={e} label={ESTADO_LABELS[e]}>
            <input
              style={styles.input}
              type="number"
              step="any"
              disabled={!podeEditarEstados || !blend.id}
              value={estados[e] || 0}
              onChange={(ev) => setEstados({ ...estados, [e]: ev.target.value })}
              onBlur={(ev) => saveEstado(e, Number(ev.target.value) || 0)}
            />
          </Field>
        ))}
      </div>
      {canEdit && <button style={{ ...styles.button('primary'), marginTop: 16 }} disabled={saving} onClick={saveBlend}>{blend.id ? 'Salvar mistura' : 'Criar mistura'}</button>}
    </div>
  );
}

// Contagens são periódicas e viram histórico — estoque de produto, estoque
// virgem e quantidade por estado da mistura são um retrato de UMA contagem
// específica (ver server/db.js), por isso tanto Explosão quanto Matéria
// Prima Processada exigem escolher a contagem antes de mostrar/editar esses
// números, do mesmo jeito que a tela de Contagem pelo celular já faz.
function ContagemSelector({ contagemId, onChange, contagens }) {
  return (
    <Field label="Contagem">
      <select style={styles.select} value={contagemId} onChange={(e) => onChange(e.target.value)}>
        <option value="">Selecione uma contagem...</option>
        {(contagens || []).map((c) => (
          <option key={c.id} value={c.id}>
            {formatDate(c.data)} — {c.titulo}{c.fornecedor ? ` (${c.fornecedor})` : ''} — {c.status}
          </option>
        ))}
      </select>
    </Field>
  );
}

function ExplosaoTab({ perms, onNavigate }) {
  const [contagens] = useAsyncList(api.contagens.list, []);
  const [contagemId, setContagemId] = useState('');
  const [contagem, setContagem] = useState(null);
  const [blends, reload] = useAsyncList(() => (contagemId ? api.contagens.blends.list(contagemId) : Promise.resolve([])), [contagemId]);
  const [rawMaterials] = useAsyncList(api.rawMaterials.list, []);
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState('');
  const canEdit = perms.explosao?.edit;

  useEffect(() => { if (contagemId) api.contagens.get(contagemId).then(setContagem); else setContagem(null); }, [contagemId]);
  const finalizada = contagem?.status === 'FINALIZADA';
  const podeEditar = canEdit && !finalizada;
  const filteredBlends = (blends || []).filter((b) => !filter || b.nome.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div>
      <h1 style={styles.h1}>Explosão — misturas e percentuais</h1>
      {perms.contagem?.view && (
        <Banner tone="default">
          A quantidade lançada aqui (por estado) é somada automaticamente ao Saldo do Inventário da contagem
          selecionada, junto com a contagem física do celular.{' '}
          <button type="button" onClick={() => onNavigate('contagem')} style={{ background: 'none', border: 'none', color: colors.accent, cursor: 'pointer', fontWeight: 600, padding: 0 }}>
            Ver Relatório de Contagem →
          </button>
        </Banner>
      )}

      <div style={styles.card}>
        <ContagemSelector contagemId={contagemId} onChange={setContagemId} contagens={contagens} />
      </div>

      {!contagemId && <p style={{ color: colors.textMuted }}>Selecione uma contagem para ver ou lançar as quantidades por estado.</p>}

      {contagemId && (
        <>
          {contagem && finalizada && (
            <Banner tone="success">Essa contagem foi finalizada — as quantidades por estado são somente consulta.</Banner>
          )}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
            <input style={{ ...styles.input, maxWidth: 300 }} placeholder="Buscar produto/mistura..." value={filter} onChange={(e) => setFilter(e.target.value)} />
            {canEdit && !showNew && <button style={styles.button('primary')} onClick={() => setShowNew(true)}>+ Nova mistura</button>}
          </div>
          {showNew && (
            <div style={{ marginTop: 12 }}>
              <BlendCard blend={{ id: null, nome: '', components: [], estados: {} }} rawMaterials={rawMaterials} canEdit={canEdit} podeEditarEstados={podeEditar} contagemId={contagemId} onChanged={() => { setShowNew(false); reload(); }} />
            </div>
          )}
          <div style={{ marginTop: 16, display: 'grid', gap: 16 }}>
            {filteredBlends.map((b) => <BlendCard key={b.id} blend={b} rawMaterials={rawMaterials} canEdit={canEdit} podeEditarEstados={podeEditar} contagemId={contagemId} onChanged={reload} />)}
            {filteredBlends.length === 0 && <p style={{ color: colors.textMuted }}>Nenhuma mistura encontrada para "{filter}".</p>}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------- Matéria-Prima Produzida

// Input controlado que mantém o valor salvo visível mesmo depois de recarregar
// os dados (ex: ao trocar de contagem ou voltar pra essa aba) — só não
// sobrescreve o que a pessoa está digitando no meio da edição (campo "sujo").
function EditableNumberCell({ value, disabled, onSave }) {
  const [local, setLocal] = useState(value);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { if (!dirty) setLocal(value); }, [value, dirty]);

  return (
    <input
      style={{ ...styles.input, width: 140 }}
      type="number" step="any"
      disabled={disabled}
      value={local}
      onChange={(e) => { setDirty(true); setLocal(e.target.value); }}
      onBlur={async (e) => { setDirty(false); await onSave(Number(e.target.value) || 0); }}
    />
  );
}

function MateriaPrimaProduzidaTab({ perms, onNavigate }) {
  const [contagens] = useAsyncList(api.contagens.list, []);
  const [contagemId, setContagemId] = useState('');
  const [contagem, setContagem] = useState(null);
  const [products] = useAsyncList(api.products.list, []);
  const [stock, reloadStock] = useAsyncList(() => (contagemId ? api.contagens.productStock.list(contagemId) : Promise.resolve([])), [contagemId]);
  const [rawMaterials] = useAsyncList(api.rawMaterials.list, []);
  const [virginStock, reloadVirgin] = useAsyncList(() => (contagemId ? api.contagens.virginStock.list(contagemId) : Promise.resolve([])), [contagemId]);
  const [summary, reloadSummary] = useAsyncList(() => (contagemId ? api.contagens.summary(contagemId) : Promise.resolve(null)), [contagemId]);
  const [filter, setFilter] = useState('');
  const canEdit = perms.materia_prima_produzida?.edit;
  const finalizada = contagem?.status === 'FINALIZADA';
  const podeEditar = canEdit && !finalizada;

  useEffect(() => { if (contagemId) api.contagens.get(contagemId).then(setContagem); else setContagem(null); }, [contagemId]);

  function refreshAll() { reloadStock(); reloadVirgin(); reloadSummary(); }

  const stockByCode = Object.fromEntries((stock || []).map((s) => [s.productCode, s.quantidade]));
  const virginByCode = Object.fromEntries((virginStock || []).map((s) => [s.rawMaterialCode, s.quantidade]));

  const filteredProducts = (products || []).filter((p) => !filter || p.code.toLowerCase().includes(filter.toLowerCase()) || p.nome.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div>
      <h1 style={styles.h1}>Matéria Prima Processada</h1>
      <p style={{ color: colors.textMuted, marginTop: -8 }}>Informe a quantidade em estoque de cada produto — o sistema recalcula quanto de matéria-prima já está produzida.</p>
      {perms.contagem?.view && (
        <Banner tone="default">
          O Total desta tela é somado automaticamente ao Saldo do Inventário da contagem selecionada, junto
          com a contagem física do celular.{' '}
          <button type="button" onClick={() => onNavigate('contagem')} style={{ background: 'none', border: 'none', color: colors.accent, cursor: 'pointer', fontWeight: 600, padding: 0 }}>
            Ver Relatório de Contagem →
          </button>
        </Banner>
      )}

      <div style={styles.card}>
        <ContagemSelector contagemId={contagemId} onChange={setContagemId} contagens={contagens} />
        <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 0 }}>
          Toda contagem nova começa zerada — informe o estoque de produto e o estoque virgem apurados nessa contagem.
        </p>
      </div>

      {!contagemId && <p style={{ color: colors.textMuted }}>Selecione uma contagem para ver ou informar os dados.</p>}

      {contagemId && (
        <>
          {contagem && finalizada && (
            <Banner tone="success">Essa contagem foi finalizada — só é possível consultar os valores dessa contagem.</Banner>
          )}

          <div style={styles.card}>
            <h2 style={styles.h2}>Estoque de produtos</h2>
            <input style={{ ...styles.input, maxWidth: 300, marginBottom: 12 }} placeholder="Buscar produto..." value={filter} onChange={(e) => setFilter(e.target.value)} />
            <table style={styles.table} className="bp-table-scroll">
              <thead><tr><th style={styles.th}>Código</th><th style={styles.th}>Produto</th><th style={styles.th}>Quantidade em estoque</th></tr></thead>
              <tbody>
                {filteredProducts.map((p) => (
                  <tr key={p.code}>
                    <td style={styles.td}>{p.code}</td>
                    <td style={styles.td}>{p.nome}</td>
                    <td style={styles.td}>
                      <EditableNumberCell
                        value={stockByCode[p.code] || 0}
                        disabled={!podeEditar}
                        onSave={async (v) => { await api.contagens.productStock.set(contagemId, p.code, v); refreshAll(); }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={styles.card}>
            <h2 style={styles.h2}>Estoque virgem por matéria-prima</h2>
            <table style={styles.table} className="bp-table-scroll">
              <thead><tr><th style={styles.th}>Código</th><th style={styles.th}>Matéria-prima</th><th style={styles.th}>Quant. virgem</th></tr></thead>
              <tbody>
                {(rawMaterials || []).map((m) => (
                  <tr key={m.code}>
                    <td style={styles.td}>{m.code}</td>
                    <td style={styles.td}>{m.nome}</td>
                    <td style={styles.td}>
                      <EditableNumberCell
                        value={virginByCode[m.code] || 0}
                        disabled={!podeEditar}
                        onSave={async (v) => { await api.contagens.virginStock.set(contagemId, m.code, v); refreshAll(); }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={styles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={styles.h2}>Total por matéria-prima já produzida</h2>
              <button style={styles.button('ghost')} onClick={refreshAll}>Recalcular</button>
            </div>
            <table style={styles.table} className="bp-table-scroll">
              <thead>
                <tr>
                  <th style={styles.th}>Código</th><th style={styles.th}>Matéria-prima</th><th style={styles.th}>Un.</th>
                  <th style={styles.th}>Peça Produzida</th><th style={styles.th}>Virgem</th>
                  {ESTADOS.map((e) => <th key={e} style={styles.th}>{ESTADO_LABELS[e]}</th>)}
                  <th style={styles.th}>Total</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.itens || []).map((i) => (
                  <tr key={i.code}>
                    <td style={styles.td}>{i.code}</td>
                    <td style={styles.td}>{i.nome}</td>
                    <td style={styles.td}>{i.unidade}</td>
                    <td style={styles.td}>{formatNumber(i.quantidade)}</td>
                    <td style={styles.td}>{formatNumber(i.virgem)}</td>
                    {ESTADOS.map((e) => <td key={e} style={styles.td}>{formatNumber(i[e])}</td>)}
                    <td style={{ ...styles.td, fontWeight: 700 }}>{formatNumber(i.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Contagem

function ImportPendentes({ contagemId, pendentes, onResolved, onGoRegister }) {
  const [rows, setRows] = useState(pendentes);
  const [selected, setSelected] = useState(() => new Set(pendentes.map((_, i) => i)));
  const [unidadePadrao, setUnidadePadrao] = useState('KG');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function updateCode(i, code) { setRows(rows.map((r, idx) => (idx === i ? { ...r, code } : r))); }

  function toggleAll(checked) {
    setSelected(checked ? new Set(rows.map((_, i) => i)) : new Set());
  }
  function toggleOne(i, checked) {
    const next = new Set(selected);
    if (checked) next.add(i); else next.delete(i);
    setSelected(next);
  }

  async function retry() {
    setBusy(true);
    setError('');
    try {
      const result = await api.contagens.importRetry(contagemId, rows);
      onResolved(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Cadastra de uma vez, com o mesmo código e a mesma descrição do arquivo —
  // não é lançamento fiscal, então não precisa abrir item por item — e já
  // tenta aplicar o saldo em seguida.
  async function cadastrarSelecionados() {
    const itens = rows.filter((_, i) => selected.has(i)).map((r) => ({ code: r.code, nome: r.descricao, unidade: unidadePadrao }));
    if (!itens.length) return;
    setBusy(true);
    setError('');
    try {
      await api.rawMaterials.bulkCreate(itens);
      const result = await api.contagens.importRetry(contagemId, rows);
      onResolved(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const allSelected = rows.length > 0 && selected.size === rows.length;

  return (
    <div style={{ ...styles.card, background: '#FCEFDA' }}>
      <h3 style={styles.h2}>Itens não encontrados no cadastro ({rows.length})</h3>
      <p style={{ fontSize: 13, color: colors.textMuted }}>
        O código do arquivo não bate com nenhuma matéria-prima cadastrada. Marque os itens que são
        matéria-prima nova de verdade e cadastre todos de uma vez, com código e nome iguais aos do
        arquivo (não é lançamento fiscal, não precisa abrir um por um) — ou corrija o código manualmente
        se for só diferença de formatação.
      </p>
      {error && <Banner tone="danger">{error}</Banner>}
      <table style={styles.table} className="bp-table-scroll">
        <thead>
          <tr>
            <th style={styles.th}><input type="checkbox" checked={allSelected} onChange={(e) => toggleAll(e.target.checked)} /></th>
            <th style={styles.th}>Código no arquivo</th><th style={styles.th}>Descrição</th><th style={styles.th}>Saldo</th><th style={styles.th}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={styles.td}><input type="checkbox" checked={selected.has(i)} onChange={(e) => toggleOne(i, e.target.checked)} /></td>
              <td style={styles.td}><input style={styles.input} value={r.code} onChange={(e) => updateCode(i, e.target.value)} /></td>
              <td style={styles.td}>{r.descricao}</td>
              <td style={styles.td}>{formatNumber(r.saldo)}</td>
              <td style={styles.td}><button style={styles.button('ghost')} onClick={() => onGoRegister(r.code, r.descricao)}>Cadastrar só este</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
        <Field label="Unidade para os novos cadastros">
          <select style={{ ...styles.select, width: 100 }} value={unidadePadrao} onChange={(e) => setUnidadePadrao(e.target.value)}>
            {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
        <button style={styles.button('primary')} disabled={busy || !selected.size} onClick={cadastrarSelecionados}>
          Cadastrar {selected.size || ''} selecionado(s) e aplicar saldo
        </button>
        <button style={styles.button('ghost')} disabled={busy} onClick={retry}>Tentar novamente</button>
      </div>
    </div>
  );
}

function ContagemDetail({ id, perms, isAdmin, onGoRegister, refreshKey }) {
  const [contagem, setContagem] = useState(null);
  const [error, setError] = useState('');
  const [importResult, setImportResult] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [filter, setFilter] = useState('');
  const canEditReport = perms.contagem?.edit;

  const load = useCallback(() => {
    api.contagens.get(id).then(setContagem).catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => { load(); }, [load, refreshKey]);

  async function saveItem(code, patch) {
    await api.contagens.setItem(id, code, patch);
    load();
  }

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const result = await api.contagens.importFile(id, file);
      setImportResult(result);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function changeStatus(status) {
    setChangingStatus(true);
    setError('');
    try {
      await api.contagens.update(id, { status });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setChangingStatus(false);
    }
  }

  if (error) return <Banner tone="danger">{error}</Banner>;
  if (!contagem) return <p>Carregando...</p>;

  const finalizada = contagem.status === 'FINALIZADA';
  const podeEditar = canEditReport && !finalizada;

  return (
    <div>
      <h2 style={styles.h2}>
        {contagem.titulo} {contagem.fornecedor ? `— ${contagem.fornecedor}` : ''}
        <span style={{ fontSize: 13, color: colors.textMuted, fontWeight: 400 }}> · {formatDate(contagem.data)}</span>{' '}
        <Badge tone={statusTone(contagem.status)}>{STATUS_LABELS[contagem.status] || contagem.status}</Badge>
      </h2>

      {finalizada && (
        <Banner tone="success">
          Essa contagem foi finalizada — só é possível consultar.{' '}
          {isAdmin && (
            <button type="button" disabled={changingStatus} onClick={() => changeStatus('ABERTA')} style={{ background: 'none', border: 'none', color: colors.success, cursor: 'pointer', fontWeight: 600, padding: 0, textDecoration: 'underline' }}>
              Reabrir contagem
            </button>
          )}
        </Banner>
      )}
      <div style={{ ...styles.card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {canEditReport && podeEditar && (
          <div>
            <label style={styles.label}>Importar Saldo do Sistema (XLS ou PDF)</label>
            <input type="file" accept=".xls,.xlsx,.pdf" onChange={handleFile} disabled={uploading} />
          </div>
        )}
        <button style={styles.button('ghost')} onClick={() => api.contagens.exportXlsx(id, contagem.titulo + '.xlsx')}>Exportar Excel</button>
        {canEditReport && podeEditar && (
          <button style={styles.button('primary')} disabled={changingStatus} onClick={() => changeStatus('FINALIZADA')}>Finalizar contagem</button>
        )}
      </div>
      {importResult && (
        <Banner tone="success" onClose={() => setImportResult(null)}>
          {importResult.matchedCount} item(ns) atualizado(s) do arquivo.
        </Banner>
      )}
      {importResult && importResult.pendentes && importResult.pendentes.length > 0 && (
        <ImportPendentes
          contagemId={id}
          pendentes={importResult.pendentes}
          onResolved={(r) => { setImportResult(r); load(); }}
          onGoRegister={(code, nome) => onGoRegister(id, code, nome)}
        />
      )}

      <input style={{ ...styles.input, maxWidth: 300, marginBottom: 12 }} placeholder="Buscar produto por código ou nome..." value={filter} onChange={(e) => setFilter(e.target.value)} />
      <table style={styles.table} className="bp-table-scroll">
        <thead>
          <tr>
            <th style={styles.th}>Código</th><th style={styles.th}>Descrição</th><th style={styles.th}>Un.</th>
            <th style={styles.th}>Saldo Sistema</th><th style={styles.th}>Saldo Inventário</th><th style={styles.th}>Notas Trânsito</th>
            <th style={styles.th}>Divergência</th><th style={styles.th}>Div. %</th><th style={styles.th}>Condição</th><th style={styles.th}>Observação</th>
          </tr>
        </thead>
        <tbody>
          {contagem.itens.filter((i) => !filter || i.rawMaterialCode.toLowerCase().includes(filter.toLowerCase()) || i.nome.toLowerCase().includes(filter.toLowerCase())).map((i) => (
            <tr key={i.rawMaterialCode}>
              <td style={styles.td}>{i.rawMaterialCode}</td>
              <td style={styles.td}>{i.nome}</td>
              <td style={styles.td}>{i.unidade}</td>
              <td style={styles.td}>
                <input style={{ ...styles.input, width: 110 }} type="number" step="any" disabled={!podeEditar}
                  defaultValue={i.saldoSistema} onBlur={(e) => saveItem(i.rawMaterialCode, { saldoSistema: Number(e.target.value) || 0 })} />
              </td>
              <td style={styles.td}>
                {formatNumber(i.saldoInventario)}
                <div style={{ fontSize: 11, color: colors.textMuted, whiteSpace: 'normal' }}>
                  {formatNumber(Number(i.contagemFisica) + Number(i.contagemQuantidade))} contado + {formatNumber(i.materiaPrimaProduzida)} produção
                </div>
              </td>
              <td style={styles.td}>
                <input style={{ ...styles.input, width: 100 }} type="number" step="any" disabled={!podeEditar}
                  defaultValue={i.notasTransito} onBlur={(e) => saveItem(i.rawMaterialCode, { notasTransito: Number(e.target.value) || 0 })} />
              </td>
              <td style={styles.td}>{formatNumber(i.divergencia)}</td>
              <td style={styles.td}>{formatPercent(i.divergenciaPercentual)}</td>
              <td style={styles.td}><Badge tone={condicaoTone(i.condicao)}>{i.condicao}</Badge></td>
              <td style={styles.td}>
                <input style={{ ...styles.input, width: 160 }} disabled={!podeEditar}
                  defaultValue={i.observacao || ''} onBlur={(e) => saveItem(i.rawMaterialCode, { observacao: e.target.value })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NovaContagemForm({ onCreated }) {
  const [form, setForm] = useState({ titulo: '', fornecedor: '', periodo: '' });
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { id } = await api.contagens.create(form);
      onCreated(id);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} style={{ ...styles.card, background: '#FAFAFA' }}>
      <p style={{ marginTop: 0, fontSize: 13, color: colors.textMuted }}>
        Data de abertura: <b>{hojeBrasilia()}</b> (hoje — não dá para escolher outra data). A contagem fica aberta
        para edição em qualquer dia até ser finalizada.
      </p>
      <div className="bp-form-grid" style={styles.formGrid}>
        <Field label="Título"><input style={styles.input} required value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} /></Field>
        <Field label="Fornecedor"><input style={styles.input} value={form.fornecedor} onChange={(e) => setForm({ ...form, fornecedor: e.target.value })} /></Field>
        <Field label="Período"><input style={styles.input} placeholder="ex: 07/2026" value={form.periodo} onChange={(e) => setForm({ ...form, periodo: e.target.value })} /></Field>
      </div>
      <button type="submit" disabled={busy} style={{ ...styles.button('primary'), marginTop: 12 }}>Iniciar Contagem</button>
    </form>
  );
}

function ContagemTab({ perms, isAdmin, selected, onSelect, onGoRegister, refreshKey }) {
  const [contagens, reload] = useAsyncList(api.contagens.list, []);
  const [showNew, setShowNew] = useState(false);
  const canEdit = perms.contagem?.edit;

  return (
    <div>
      <h1 style={styles.h1}>Relatório de Contagem</h1>
      {selected ? (
        <div>
          <button style={{ ...styles.button('ghost'), marginBottom: 12 }} onClick={() => onSelect(null)}>← Voltar para a lista</button>
          <ContagemDetail id={selected} perms={perms} isAdmin={isAdmin} onGoRegister={onGoRegister} refreshKey={refreshKey} />
        </div>
      ) : (
        <div>
          {canEdit && !showNew && <button style={styles.button('primary')} onClick={() => setShowNew(true)}>+ Iniciar Contagem</button>}
          {showNew && <div style={{ marginTop: 12 }}><NovaContagemForm onCreated={(id) => { setShowNew(false); reload(); onSelect(id); }} /></div>}
          <table style={{ ...styles.table, marginTop: 16 }} className="bp-table-scroll">
            <thead><tr><th style={styles.th}>Data</th><th style={styles.th}>Título</th><th style={styles.th}>Fornecedor</th><th style={styles.th}>Período</th><th style={styles.th}>Status</th><th style={styles.th}></th></tr></thead>
            <tbody>
              {(contagens || []).map((c) => (
                <tr key={c.id}>
                  <td style={styles.td}>{formatDate(c.data)}</td>
                  <td style={styles.td}>{c.titulo}</td>
                  <td style={styles.td}>{c.fornecedor}</td>
                  <td style={styles.td}>{c.periodo}</td>
                  <td style={styles.td}><Badge tone={statusTone(c.status)}>{STATUS_LABELS[c.status] || c.status}</Badge></td>
                  <td style={styles.td}><button style={styles.button('ghost')} onClick={() => onSelect(c.id)}>Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------- Contagem mobile

function ContagemMobileTab({ perms }) {
  const [contagens] = useAsyncList(api.contagens.list, []);
  const [contagemId, setContagemId] = useState('');
  const [contagem, setContagem] = useState(null);
  const [busca, setBusca] = useState('');
  const [selecionado, setSelecionado] = useState(null);
  const [lancamentos, setLancamentos] = useState([]);
  const [valor, setValor] = useState('');
  const [tipo, setTipo] = useState('PESO');

  useEffect(() => { if (contagemId) api.contagens.get(contagemId).then(setContagem); else setContagem(null); }, [contagemId]);

  async function selecionarItem(item) {
    setSelecionado(item);
    setTipo('PESO');
    setLancamentos(await api.contagens.lancamentos(contagemId, item.rawMaterialCode));
  }

  async function refreshItem() {
    const atualizado = await api.contagens.get(contagemId);
    setContagem(atualizado);
    const item = atualizado.itens.find((i) => i.rawMaterialCode === selecionado.rawMaterialCode);
    setSelecionado(item);
    setLancamentos(await api.contagens.lancamentos(contagemId, item.rawMaterialCode));
  }

  async function adicionar() {
    const v = Number(valor);
    if (!v && v !== 0) return;
    // Peso e Quantidade são só dois jeitos de registrar a mesma contagem
    // física (com balança ou contando peça por peça) — livre pra qualquer
    // matéria-prima, e os dois somam no Saldo do Inventário.
    await api.contagens.addLancamento(contagemId, selecionado.rawMaterialCode, v, tipo);
    setValor('');
    await refreshItem();
  }

  async function remover(lancamentoId) {
    await api.contagens.removeLancamento(contagemId, selecionado.rawMaterialCode, lancamentoId);
    await refreshItem();
  }

  const itensFiltrados = contagem ? contagem.itens.filter((i) => !busca || i.rawMaterialCode.toLowerCase().includes(busca.toLowerCase()) || i.nome.toLowerCase().includes(busca.toLowerCase())) : [];
  const finalizada = contagem?.status === 'FINALIZADA';
  const podeContar = perms.contagem_mobile?.edit && !finalizada;

  return (
    <div style={styles.mobileScreen}>
      <h1 style={styles.h1}>Contagem física</h1>
      {!perms.contagem_mobile?.edit && <Banner tone="warning">Você não tem permissão para lançar contagem.</Banner>}

      <Field label="Contagem">
        <select style={styles.select} value={contagemId} onChange={(e) => { setContagemId(e.target.value); setSelecionado(null); }}>
          <option value="">Selecione...</option>
          {(contagens || []).map((c) => <option key={c.id} value={c.id}>{formatDate(c.data)} — {c.titulo} — {STATUS_LABELS[c.status] || c.status}</option>)}
        </select>
      </Field>

      {contagem && finalizada && (
        <Banner tone="success">Essa contagem foi finalizada — só é possível consultar o que já foi contado.</Banner>
      )}

      {contagem && !selecionado && (
        <div style={{ marginTop: 16 }}>
          <input style={styles.input} placeholder="Buscar matéria-prima por código ou nome..." value={busca} onChange={(e) => setBusca(e.target.value)} />
          <div style={{ marginTop: 12, display: 'grid', gap: 8, maxHeight: 480, overflowY: 'auto' }}>
            {itensFiltrados.map((i) => (
              <button key={i.rawMaterialCode} style={{ ...styles.button('ghost'), textAlign: 'left', display: 'flex', justifyContent: 'space-between' }} onClick={() => selecionarItem(i)}>
                <span>{i.rawMaterialCode} — {i.nome}</span>
                <span style={{ color: colors.textMuted }}>{formatNumber(i.saldoInventario)} {i.unidade}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selecionado && (
        <div style={{ marginTop: 16 }}>
          <button style={styles.button('ghost')} onClick={() => setSelecionado(null)}>← Buscar outro material</button>
          <div style={{ ...styles.card, marginTop: 12, textAlign: 'center' }}>
            <div style={{ fontWeight: 700 }}>{selecionado.rawMaterialCode} — {selecionado.nome}</div>
            <div style={{ color: colors.textMuted, fontSize: 13 }}>Unidade: {selecionado.unidade}</div>
            <div style={{ ...styles.bigNumber, marginTop: 12 }}>
              {formatNumber(Number(selecionado.contagemFisica) + Number(selecionado.contagemQuantidade))}
            </div>
            <div style={{ color: colors.textMuted, fontSize: 12 }}>contado fisicamente até agora</div>
            {(Number(selecionado.contagemFisica) !== 0 || Number(selecionado.contagemQuantidade) !== 0) && (
              <div style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
                ({formatNumber(selecionado.contagemFisica)} em peso + {formatNumber(selecionado.contagemQuantidade)} em quantidade)
              </div>
            )}
            <div style={{ color: colors.textMuted, fontSize: 12, marginTop: 8, borderTop: `1px solid ${colors.border}`, paddingTop: 8 }}>
              + {formatNumber(selecionado.materiaPrimaProduzida)} já produzido (Explosão) = <b>{formatNumber(selecionado.saldoInventario)}</b> no Relatório de Contagem
            </div>
          </div>

          {podeContar && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" style={styles.button(tipo === 'PESO' ? 'primary' : 'ghost')} onClick={() => setTipo('PESO')}>
                  Peso (KG)
                </button>
                <button type="button" style={styles.button(tipo === 'QUANTIDADE' ? 'primary' : 'ghost')} onClick={() => setTipo('QUANTIDADE')}>
                  Quantidade (UN)
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input style={{ ...styles.input, fontSize: 20, textAlign: 'center' }} type="number" inputMode="decimal" step="any"
                  placeholder={tipo === 'PESO' ? '+ valor em KG' : '+ quantidade em UN'} value={valor} onChange={(e) => setValor(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') adicionar(); }} />
                <button style={styles.button('primary')} onClick={adicionar}>Somar</button>
              </div>
            </div>
          )}

          <h3 style={{ ...styles.h2, marginTop: 20 }}>Lançamentos</h3>
          {lancamentos.length === 0 && <p style={{ color: colors.textMuted, fontSize: 13 }}>Nenhum lançamento ainda.</p>}
          <div style={{ display: 'grid', gap: 8 }}>
            {lancamentos.map((l) => (
              <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '8px 12px' }}>
                <span>
                  {formatNumber(l.valor)} {l.tipo === 'QUANTIDADE' ? 'un.' : selecionado.unidade}
                  {' '}<Badge tone={l.tipo === 'QUANTIDADE' ? 'default' : 'success'}>{l.tipo === 'QUANTIDADE' ? 'Quantidade' : 'Peso'}</Badge>
                  {' '}<span style={{ color: colors.textMuted, fontSize: 12 }}>— {l.criadoPor}</span>
                </span>
                {podeContar && <button style={styles.button('danger')} onClick={() => remover(l.id)}>Remover</button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------- Usuários

function PendingUserRow({ user, canEdit, onResolved }) {
  const [role, setRole] = useState('estoque');

  async function aprovar() {
    await api.users.update(user.id, { role });
    onResolved();
  }
  async function recusar() {
    if (!confirm(`Recusar o cadastro de ${user.name}?`)) return;
    await api.users.remove(user.id);
    onResolved();
  }

  return (
    <tr>
      <td style={styles.td}>{user.username}</td>
      <td style={styles.td}>{user.name}</td>
      <td style={styles.td}>{user.email || '-'}</td>
      <td style={styles.td}>{user.phone || '-'}</td>
      {canEdit && (
        <td style={styles.td}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select style={{ ...styles.select, width: 140 }} value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.filter((r) => r !== 'pendente').map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            <button style={styles.button('primary')} onClick={aprovar}>Aprovar</button>
            <button style={styles.button('danger')} onClick={recusar}>Recusar</button>
          </div>
        </td>
      )}
    </tr>
  );
}

function UsuariosTab({ perms }) {
  const [users, reload] = useAsyncList(api.users.list, []);
  const [form, setForm] = useState({ username: '', password: '', name: '', role: 'estoque' });
  const [error, setError] = useState('');
  const canEdit = perms.usuarios?.edit;

  async function create(e) {
    e.preventDefault();
    setError('');
    try {
      await api.users.create(form);
      setForm({ username: '', password: '', name: '', role: 'estoque' });
      reload();
    } catch (err) {
      setError(err.message);
    }
  }

  const pendentes = (users || []).filter((u) => u.role === 'pendente');
  const ativos = (users || []).filter((u) => u.role !== 'pendente');

  return (
    <div>
      <h1 style={styles.h1}>Usuários</h1>

      {pendentes.length > 0 && (
        <div style={{ ...styles.card, background: '#FCEFDA' }}>
          <h2 style={styles.h2}>Cadastros aguardando aprovação ({pendentes.length})</h2>
          <table style={styles.table} className="bp-table-scroll">
            <thead><tr><th style={styles.th}>Login</th><th style={styles.th}>Nome</th><th style={styles.th}>E-mail</th><th style={styles.th}>Telefone</th>{canEdit && <th style={styles.th}>Ação</th>}</tr></thead>
            <tbody>
              {pendentes.map((u) => <PendingUserRow key={u.id} user={u} canEdit={canEdit} onResolved={reload} />)}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <form onSubmit={create} style={{ ...styles.card, background: '#FAFAFA' }}>
          {error && <Banner tone="danger">{error}</Banner>}
          <div className="bp-form-grid" style={styles.formGrid}>
            <Field label="Login"><input style={styles.input} required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
            <Field label="Senha"><input style={styles.input} type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            <Field label="Nome"><input style={styles.input} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Papel">
              <select style={styles.select} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.filter((r) => r !== 'pendente').map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </Field>
          </div>
          <button type="submit" style={{ ...styles.button('primary'), marginTop: 12 }}>Criar usuário</button>
        </form>
      )}
      <table style={{ ...styles.table, marginTop: 16 }} className="bp-table-scroll">
        <thead><tr><th style={styles.th}>Login</th><th style={styles.th}>Nome</th><th style={styles.th}>Papel</th>{canEdit && <th style={styles.th}></th>}</tr></thead>
        <tbody>
          {ativos.map((u) => (
            <tr key={u.id}>
              <td style={styles.td}>{u.username}</td>
              <td style={styles.td}>{u.name}</td>
              <td style={styles.td}>{ROLE_LABELS[u.role] || u.role}</td>
              {canEdit && <td style={styles.td}><button style={styles.button('danger')} onClick={async () => { if (confirm(`Excluir ${u.username}?`)) { await api.users.remove(u.id); reload(); } }}>Excluir</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------ Permissões

function PermissoesTab() {
  const [data, reload] = useAsyncList(api.permissions.get, []);
  if (!data) return <p>Carregando...</p>;

  async function toggle(tabId, role, field) {
    const current = data.matrix[tabId];
    const canView = field === 'view' ? !current.view.includes(role) : current.view.includes(role);
    const canEdit = field === 'edit' ? !current.edit.includes(role) : current.edit.includes(role);
    await api.permissions.set(tabId, role, canView, canEdit);
    reload();
  }

  return (
    <div>
      <h1 style={styles.h1}>Permissões</h1>
      <table style={styles.table} className="bp-table-scroll">
        <thead>
          <tr>
            <th style={styles.th}>Aba</th>
            {data.roles.filter((r) => r !== 'pendente').map((r) => <th key={r} style={styles.th} colSpan={2}>{ROLE_LABELS[r] || r}</th>)}
          </tr>
          <tr>
            <th style={styles.th}></th>
            {data.roles.filter((r) => r !== 'pendente').map((r) => (
              <React.Fragment key={r}>
                <th style={styles.th}>Ver</th>
                <th style={styles.th}>Editar</th>
              </React.Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.tabs.map((tab) => (
            <tr key={tab}>
              <td style={styles.td}>{tab}</td>
              {data.roles.filter((r) => r !== 'pendente').map((r) => (
                <React.Fragment key={r}>
                  <td style={styles.td}><input type="checkbox" checked={data.matrix[tab].view.includes(r)} onChange={() => toggle(tab, r, 'view')} /></td>
                  <td style={styles.td}><input type="checkbox" checked={data.matrix[tab].edit.includes(r)} onChange={() => toggle(tab, r, 'edit')} /></td>
                </React.Fragment>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------- Layout

function Layout({ user, perms, onLogout }) {
  const visibleNav = NAV_ITEMS.filter((n) => perms[n.id]?.view);
  const ungroupedNav = visibleNav.filter((n) => !n.group);
  const groupedNav = {};
  visibleNav.filter((n) => n.group).forEach((n) => { (groupedNav[n.group] = groupedNav[n.group] || []).push(n); });
  const [activeTab, setActiveTab] = useState(visibleNav[0]?.id || 'contagem_mobile');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState(() => Object.fromEntries(Object.keys(NAV_GROUPS).map((g) => [g, false])));
  function toggleGroup(g) { setOpenGroups((prev) => ({ ...prev, [g]: !prev[g] })); }
  const [contagemSelecionada, setContagemSelecionada] = useState(null);
  const [pendingRegister, setPendingRegister] = useState(null); // { contagemId, code, nome }
  const [contagemRefreshKey, setContagemRefreshKey] = useState(0);

  function selectTab(id) {
    setActiveTab(id);
    setSidebarOpen(false);
    const item = NAV_ITEMS.find((n) => n.id === id);
    if (item?.group) setOpenGroups((prev) => ({ ...prev, [item.group]: true }));
  }

  function goRegister(contagemId, code, nome) {
    setPendingRegister({ contagemId, code, nome });
    setContagemSelecionada(contagemId);
    setActiveTab('cadastros');
  }

  function onMaterialRegistered() {
    if (pendingRegister) {
      setActiveTab('contagem');
      setContagemRefreshKey((k) => k + 1);
      setPendingRegister(null);
    }
  }

  return (
    <div style={styles.app}>
      <GlobalStyle />
      <div className={`bp-sidebar-backdrop ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)} />
      <div className={`bp-sidebar ${sidebarOpen ? 'open' : ''}`} style={styles.sidebar}>
        <div style={styles.sidebarBrand}>Barella Plast<br />Inventário</div>
        {Object.entries(NAV_GROUPS).map(([groupId, groupLabel]) => {
          const items = groupedNav[groupId];
          if (!items || !items.length) return null;
          const open = !!openGroups[groupId];
          return (
            <div key={groupId}>
              <div style={styles.sidebarGroupHeader} onClick={() => toggleGroup(groupId)}>
                <span>{groupLabel}</span>
                <span>{open ? '▾' : '▸'}</span>
              </div>
              {open && items.map((n) => (
                <div key={n.id} style={styles.sidebarLink(activeTab === n.id, true)} onClick={() => selectTab(n.id)}>{n.label}</div>
              ))}
            </div>
          );
        })}
        {ungroupedNav.map((n) => (
          <div key={n.id} style={styles.sidebarLink(activeTab === n.id)} onClick={() => selectTab(n.id)}>{n.label}</div>
        ))}
      </div>
      <div style={styles.main}>
        <div style={styles.topbar}>
          <button className="bp-menu-btn" style={{ ...styles.button('ghost'), display: 'none' }} onClick={() => setSidebarOpen(true)}>☰</button>
          <span style={{ fontSize: 13, color: colors.textMuted }}>{user.name} — {ROLE_LABELS[user.role] || user.role}</span>
          <button style={styles.button('ghost')} onClick={onLogout}>Sair</button>
        </div>
        <div className="bp-content" style={styles.content}>
          {activeTab === 'cadastros' && <CadastrosTab perms={perms} pendingRegister={pendingRegister} onRegistered={onMaterialRegistered} />}
          {activeTab === 'explosao' && <ExplosaoTab perms={perms} onNavigate={selectTab} />}
          {activeTab === 'materia_prima_produzida' && <MateriaPrimaProduzidaTab perms={perms} onNavigate={selectTab} />}
          {activeTab === 'contagem' && <ContagemTab perms={perms} isAdmin={user.role === 'admin'} selected={contagemSelecionada} onSelect={setContagemSelecionada} onGoRegister={goRegister} refreshKey={contagemRefreshKey} />}
          {activeTab === 'contagem_mobile' && <ContagemMobileTab perms={perms} />}
          {activeTab === 'usuarios' && <UsuariosTab perms={perms} />}
          {activeTab === 'permissoes' && <PermissoesTab />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------- App

export default function App() {
  const [user, setUser] = useState(null);
  const [perms, setPerms] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    api.auth.me().then(({ user, permissions }) => { setUser(user); setPerms(permissions); }).catch(() => setToken(null)).finally(() => setLoading(false));
  }, []);

  function handleLogin(u) {
    api.auth.me().then(({ user, permissions }) => { setUser(user); setPerms(permissions); });
  }

  function handleLogout() {
    setToken(null);
    setUser(null);
    setPerms(null);
  }

  if (loading) return null;
  if (!user) return <Login onLogin={handleLogin} />;
  if (user.role === 'pendente') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.sidebarBg, padding: 20 }}>
        <div style={{ background: colors.surface, padding: 32, borderRadius: 12, width: 360, textAlign: 'center' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 0 }}>Aguardando aprovação</h1>
          <p style={{ color: colors.textMuted, fontSize: 14 }}>
            Seu cadastro ({user.name}) ainda não foi aprovado por um administrador. Assim que for liberado, você poderá acessar normalmente.
          </p>
          <button style={{ ...styles.button('ghost'), marginTop: 12 }} onClick={handleLogout}>Sair</button>
        </div>
      </div>
    );
  }
  return <Layout user={user} perms={perms} onLogout={handleLogout} />;
}
