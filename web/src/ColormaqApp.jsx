// Telas da Colormaq — segundo fornecedor do sistema. Arquivo à parte (não
// dentro de App.jsx) para não misturar com o código da Mondial: reaproveita
// só os pedaços genéricos de lá (Field/Badge/Banner/useAsyncList/
// EditableNumberCell/EditableTextCell, exportados em App.jsx) e de
// styles.jsx/constants.js — nada específico da Mondial é tocado por este
// arquivo. Mesmo padrão visual/UX das telas da Mondial, adaptado ao modelo
// da Colormaq (ver server/db.js e server/colormaqCalc.js): produto com
// receita de resina+masterbatch, blend derivado automaticamente, só 2
// estados de mistura, e contagem física em KG (matéria-prima) ou UN
// (produto, alimenta a Explosão).
import React, { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';
import { styles, colors } from './styles.jsx';
import { Field, Badge, Banner, useAsyncList, EditableNumberCell, EditableTextCell } from './App.jsx';
import { ESTADOS_COLORMAQ, ESTADO_LABELS_COLORMAQ, STATUS_LABELS, statusTone, condicaoTone, formatNumber, formatPercent, formatDate, parseDecimal } from './constants.js';

const TIPO_LABELS = { RESINA: 'Resina', MASTERBATCH: 'Masterbatch' };

// -------------------------------------------------------------- Cadastros

function ColormaqRawMaterialForm({ initial, isEdit, onSaved, onCancel }) {
  const [form, setForm] = useState(initial || { code: '', nome: '', unidade: 'KG', tipo: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = { ...form, tipo: form.tipo || null };
      if (isEdit) await api.colormaq.rawMaterials.update(initial.code, payload);
      else await api.colormaq.rawMaterials.create(payload);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={styles.card}>
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="bp-form-grid" style={styles.formGrid}>
        <Field label="Código">
          <input style={styles.input} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
        </Field>
        <Field label="Nome">
          <input style={styles.input} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
        </Field>
        <Field label="Unidade">
          <input style={styles.input} value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })} />
        </Field>
        <Field label="Tipo (define a receita do produto)">
          <select style={styles.select} value={form.tipo || ''} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
            <option value="">— nenhum —</option>
            <option value="RESINA">Resina</option>
            <option value="MASTERBATCH">Masterbatch</option>
          </select>
        </Field>
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button type="submit" style={styles.button('primary')} disabled={saving}>Salvar</button>
        <button type="button" style={styles.button('ghost')} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

function ColormaqRawMaterialsSection({ canEdit }) {
  const [materials, reload] = useAsyncList(api.colormaq.rawMaterials.list, []);
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState('');

  async function remove(code) {
    if (!window.confirm(`Excluir a matéria-prima ${code}?`)) return;
    await api.colormaq.rawMaterials.remove(code);
    reload();
  }

  const filtered = (materials || []).filter((m) => !filter || m.code.toLowerCase().includes(filter.toLowerCase()) || m.nome.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <input style={{ ...styles.input, maxWidth: 280 }} placeholder="Buscar..." value={filter} onChange={(e) => setFilter(e.target.value)} />
        {canEdit && !showNew && <button style={styles.button('primary')} onClick={() => setShowNew(true)}>+ Nova matéria-prima</button>}
      </div>
      {showNew && <ColormaqRawMaterialForm onSaved={() => { setShowNew(false); reload(); }} onCancel={() => setShowNew(false)} />}
      {editing && <ColormaqRawMaterialForm initial={editing} isEdit onSaved={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />}
      <table style={{ ...styles.table, marginTop: 12 }} className="bp-table-scroll">
        <thead><tr><th style={styles.th}>Código</th><th style={styles.th}>Nome</th><th style={styles.th}>Unidade</th><th style={styles.th}>Tipo</th><th style={styles.th}></th></tr></thead>
        <tbody>
          {filtered.map((m) => (
            <tr key={m.code}>
              <td style={styles.td}>{m.code}</td>
              <td style={styles.td}>{m.nome}</td>
              <td style={styles.td}>{m.unidade}</td>
              <td style={styles.td}>{m.tipo ? <Badge tone="default">{TIPO_LABELS[m.tipo]}</Badge> : '-'}</td>
              <td style={styles.td}>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={styles.button('ghost')} onClick={() => setEditing(m)}>Editar</button>
                    <button style={styles.button('danger')} onClick={() => remove(m.code)}>Excluir</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ColormaqProductForm({ code, rawMaterials, onSaved, onCancel }) {
  const isEdit = !!code;
  const [form, setForm] = useState({ code: code || '', nome: '' });
  const [materials, setMaterials] = useState([{ rawMaterialCode: '', consumoUnitario: '' }, { rawMaterialCode: '', consumoUnitario: '' }]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!code) return;
    api.colormaq.products.get(code).then((p) => {
      setForm({ code: p.code, nome: p.nome });
      setMaterials(p.materials.length ? p.materials.map((m) => ({ rawMaterialCode: m.rawMaterialCode, consumoUnitario: m.consumoUnitario })) : [{ rawMaterialCode: '', consumoUnitario: '' }]);
    });
  }, [code]);

  function updateMaterial(idx, patch) {
    setMaterials((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  }
  function addMaterial() { setMaterials((prev) => [...prev, { rawMaterialCode: '', consumoUnitario: '' }]); }
  function removeMaterial(idx) { setMaterials((prev) => prev.filter((_, i) => i !== idx)); }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = {
        ...form,
        materials: materials.filter((m) => m.rawMaterialCode).map((m) => ({ rawMaterialCode: m.rawMaterialCode, consumoUnitario: parseDecimal(m.consumoUnitario) })),
      };
      if (isEdit) await api.colormaq.products.update(code, payload);
      else await api.colormaq.products.create(payload);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={styles.card}>
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="bp-form-grid" style={styles.formGrid}>
        <Field label="Código">
          <input style={styles.input} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
        </Field>
        <Field label="Nome">
          <input style={styles.input} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
        </Field>
      </div>
      <h3 style={{ ...styles.h2, marginTop: 16 }}>Receita (resina + masterbatch)</h3>
      {materials.map((m, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <Field label="Matéria-prima">
              <select style={styles.select} value={m.rawMaterialCode} onChange={(e) => updateMaterial(idx, { rawMaterialCode: e.target.value })}>
                <option value="">— selecione —</option>
                {(rawMaterials || []).map((rm) => (
                  <option key={rm.code} value={rm.code}>{rm.code} — {rm.nome}{rm.tipo ? ` (${TIPO_LABELS[rm.tipo]})` : ''}</option>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ width: 160 }}>
            <Field label="Consumo unitário">
              <input style={styles.input} value={m.consumoUnitario} onChange={(e) => updateMaterial(idx, { consumoUnitario: e.target.value })} />
            </Field>
          </div>
          <button type="button" style={styles.button('ghost')} onClick={() => removeMaterial(idx)}>Remover</button>
        </div>
      ))}
      <button type="button" style={styles.button('ghost')} onClick={addMaterial}>+ Adicionar matéria-prima</button>
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button type="submit" style={styles.button('primary')} disabled={saving}>Salvar</button>
        <button type="button" style={styles.button('ghost')} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

function ColormaqProductsSection({ canEdit }) {
  const [products, reload] = useAsyncList(api.colormaq.products.list, []);
  const [rawMaterials] = useAsyncList(api.colormaq.rawMaterials.list, []);
  const [editingCode, setEditingCode] = useState(undefined);
  const [filter, setFilter] = useState('');

  async function remove(code) {
    if (!window.confirm(`Excluir o produto ${code}?`)) return;
    await api.colormaq.products.remove(code);
    reload();
  }

  const filtered = (products || []).filter((p) => !filter || p.code.toLowerCase().includes(filter.toLowerCase()) || p.nome.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <input style={{ ...styles.input, maxWidth: 280 }} placeholder="Buscar..." value={filter} onChange={(e) => setFilter(e.target.value)} />
        {canEdit && editingCode === undefined && <button style={styles.button('primary')} onClick={() => setEditingCode(null)}>+ Novo produto</button>}
      </div>
      {editingCode !== undefined && (
        <ColormaqProductForm code={editingCode} rawMaterials={rawMaterials} onSaved={() => { setEditingCode(undefined); reload(); }} onCancel={() => setEditingCode(undefined)} />
      )}
      <table style={{ ...styles.table, marginTop: 12 }} className="bp-table-scroll">
        <thead><tr><th style={styles.th}>Código</th><th style={styles.th}>Nome</th><th style={styles.th}></th></tr></thead>
        <tbody>
          {filtered.map((p) => (
            <tr key={p.code}>
              <td style={styles.td}>{p.code}</td>
              <td style={styles.td}>{p.nome}</td>
              <td style={styles.td}>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={styles.button('ghost')} onClick={() => setEditingCode(p.code)}>Editar</button>
                    <button style={styles.button('danger')} onClick={() => remove(p.code)}>Excluir</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ColormaqCadastrosTab({ perms }) {
  const [sub, setSub] = useState('materias');
  const canEdit = perms.colormaq_cadastros?.edit;
  return (
    <div>
      <h1 style={styles.h1}>Colormaq — Cadastros</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button style={styles.button(sub === 'materias' ? 'primary' : 'ghost')} onClick={() => setSub('materias')}>Matérias-primas</button>
        <button style={styles.button(sub === 'produtos' ? 'primary' : 'ghost')} onClick={() => setSub('produtos')}>Produtos</button>
      </div>
      {sub === 'materias' ? <ColormaqRawMaterialsSection canEdit={canEdit} /> : <ColormaqProductsSection canEdit={canEdit} />}
    </div>
  );
}

// -------------------------------------------------------------- Explosão

function ColormaqContagemSelector({ contagemId, onChange, contagens }) {
  return (
    <Field label="Contagem">
      <select style={styles.select} value={contagemId} onChange={(e) => onChange(e.target.value)}>
        <option value="">Selecione uma contagem...</option>
        {(contagens || []).map((c) => (
          <option key={c.id} value={c.id}>{formatDate(c.data)} — {c.titulo} — {STATUS_LABELS[c.status] || c.status}</option>
        ))}
      </select>
    </Field>
  );
}

function ColormaqBlendCard({ blend, canEdit, contagemId, onChanged }) {
  const [saving, setSaving] = useState(false);
  const resina = blend.components.find((c) => c.papel === 'RESINA');
  const masterbatch = blend.components.find((c) => c.papel === 'MASTERBATCH');

  async function setEstado(estado, valor) {
    setSaving(true);
    try {
      await api.colormaq.contagens.blends.setEstado(contagemId, blend.id, estado, parseDecimal(valor));
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={styles.card}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{blend.nome}</div>
      <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 12 }}>
        Resina: {resina?.rawMaterialCode || '-'} · Masterbatch: {masterbatch?.rawMaterialCode || '-'}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {ESTADOS_COLORMAQ.map((estado) => (
          <Field key={estado} label={ESTADO_LABELS_COLORMAQ[estado]}>
            <EditableNumberCell width={120} value={blend.estados[estado] || 0} disabled={!canEdit || saving} onSave={(v) => setEstado(estado, v)} />
          </Field>
        ))}
      </div>
    </div>
  );
}

export function ColormaqExplosaoTab({ perms, onNavigate }) {
  const [contagens] = useAsyncList(api.colormaq.contagens.list, []);
  const [contagemId, setContagemId] = useState('');
  const [contagem, setContagem] = useState(null);
  const [blends, reload] = useAsyncList(() => (contagemId ? api.colormaq.contagens.blends.list(contagemId) : Promise.resolve([])), [contagemId]);
  const [filter, setFilter] = useState('');
  const canEdit = perms.colormaq_explosao?.edit;

  useEffect(() => { if (contagemId) api.colormaq.contagens.get(contagemId).then(setContagem); else setContagem(null); }, [contagemId]);
  const finalizada = contagem?.status === 'FINALIZADA';
  const podeEditar = canEdit && !finalizada;
  const filteredBlends = (blends || []).filter((b) => !filter || b.nome.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div>
      <h1 style={styles.h1}>Colormaq — Explosão (mistura reciclada)</h1>
      {perms.colormaq_contagem?.view && (
        <Banner tone="default">
          A quantidade lançada aqui é somada automaticamente ao saldo da matéria-prima no Relatório de Contagem.{' '}
          <button type="button" onClick={() => onNavigate('colormaq_contagem')} style={{ background: 'none', border: 'none', color: colors.accent, cursor: 'pointer', fontWeight: 600, padding: 0 }}>
            Ver Relatório de Contagem →
          </button>
        </Banner>
      )}
      <div style={styles.card}>
        <ColormaqContagemSelector contagemId={contagemId} onChange={setContagemId} contagens={contagens} />
      </div>
      {!contagemId && <p style={{ color: colors.textMuted }}>Selecione uma contagem para ver ou lançar Mistura/Moído.</p>}
      {contagemId && (
        <>
          {finalizada && <Banner tone="success">Essa contagem foi finalizada — só é possível consultar.</Banner>}
          <input style={{ ...styles.input, maxWidth: 300, marginBottom: 16 }} placeholder="Buscar blend..." value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div style={{ display: 'grid', gap: 16 }}>
            {filteredBlends.map((b) => <ColormaqBlendCard key={b.id} blend={b} canEdit={podeEditar} contagemId={contagemId} onChanged={reload} />)}
            {filteredBlends.length === 0 && <p style={{ color: colors.textMuted }}>Nenhum blend encontrado — blends são criados automaticamente ao cadastrar um produto com resina + masterbatch.</p>}
          </div>
        </>
      )}
    </div>
  );
}

// -------------------------------------------------- Matéria-Prima Processada

export function ColormaqMateriaPrimaProcessadaTab({ perms }) {
  const [contagens] = useAsyncList(api.colormaq.contagens.list, []);
  const [contagemId, setContagemId] = useState('');
  const [contagem, setContagem] = useState(null);
  const [products] = useAsyncList(api.colormaq.products.list, []);
  const [pecas, reloadPecas] = useAsyncList(() => (contagemId ? api.colormaq.contagens.pecasProduzidas.list(contagemId) : Promise.resolve([])), [contagemId]);
  const [summary, reloadSummary] = useAsyncList(() => (contagemId ? api.colormaq.contagens.summary(contagemId) : Promise.resolve({ itens: [] })), [contagemId]);
  const [filter, setFilter] = useState('');
  const canEdit = perms.colormaq_materia_prima_produzida?.edit;

  useEffect(() => { if (contagemId) api.colormaq.contagens.get(contagemId).then(setContagem); else setContagem(null); }, [contagemId]);
  const finalizada = contagem?.status === 'FINALIZADA';
  const podeEditar = canEdit && !finalizada;

  async function salvar(code, quantidade) {
    await api.colormaq.contagens.pecasProduzidas.set(contagemId, code, quantidade);
    await Promise.all([reloadPecas(), reloadSummary()]);
  }

  const pecasByProduct = new Map((pecas || []).map((p) => [p.productCode, p.quantidade]));
  const filtered = (products || []).filter((p) => !filter || p.code.toLowerCase().includes(filter.toLowerCase()) || p.nome.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div>
      <h1 style={styles.h1}>Colormaq — Matéria-Prima Processada</h1>
      <div style={styles.card}>
        <ColormaqContagemSelector contagemId={contagemId} onChange={setContagemId} contagens={contagens} />
      </div>
      {!contagemId && <p style={{ color: colors.textMuted }}>Selecione uma contagem para lançar as peças produzidas.</p>}
      {contagemId && (
        <>
          {finalizada && <Banner tone="success">Essa contagem foi finalizada — só é possível consultar.</Banner>}
          <input style={{ ...styles.input, maxWidth: 300, marginBottom: 16 }} placeholder="Buscar produto..." value={filter} onChange={(e) => setFilter(e.target.value)} />
          <table style={styles.table} className="bp-table-scroll">
            <thead><tr><th style={styles.th}>Código</th><th style={styles.th}>Produto</th><th style={styles.th}>Peças produzidas</th></tr></thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.code}>
                  <td style={styles.td}>{p.code}</td>
                  <td style={styles.td}>{p.nome}</td>
                  <td style={styles.td}>
                    <EditableNumberCell width={120} value={pecasByProduct.get(p.code) || 0} disabled={!podeEditar} onSave={(v) => salvar(p.code, v)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ ...styles.h2, marginTop: 24 }}>Resumo por matéria-prima</h3>
          <table style={styles.table} className="bp-table-scroll">
            <thead><tr><th style={styles.th}>Código</th><th style={styles.th}>Matéria-prima</th><th style={styles.th}>Consumido (peças)</th><th style={styles.th}>Reciclado (mistura)</th><th style={styles.th}>Total</th></tr></thead>
            <tbody>
              {(summary?.itens || []).map((s) => (
                <tr key={s.code}>
                  <td style={styles.td}>{s.code}</td>
                  <td style={styles.td}>{s.nome}</td>
                  <td style={styles.td}>{formatNumber(s.consumido)}</td>
                  <td style={styles.td}>{formatNumber(s.reciclado)}</td>
                  <td style={styles.td}><b>{formatNumber(s.total)}</b> {s.unidade}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// -------------------------------------------------------- Relatório de Contagem

function ColormaqNovaContagemForm({ onCreated }) {
  const [titulo, setTitulo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { id } = await api.colormaq.contagens.create({ titulo });
      onCreated(id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={styles.card}>
      {error && <Banner tone="danger">{error}</Banner>}
      <Field label="Título">
        <input style={styles.input} value={titulo} onChange={(e) => setTitulo(e.target.value)} required placeholder="ex: Contagem 18.09" />
      </Field>
      <button type="submit" style={{ ...styles.button('primary'), marginTop: 12 }} disabled={busy}>Iniciar Contagem</button>
    </form>
  );
}

function ColormaqContagemDetail({ id, perms, isAdmin, refreshKey }) {
  const [contagem, setContagem] = useState(null);
  const [error, setError] = useState('');
  const [changingStatus, setChangingStatus] = useState(false);
  const [filter, setFilter] = useState('');
  const canEditReport = perms.colormaq_contagem?.edit;

  const load = useCallback(() => api.colormaq.contagens.get(id).then(setContagem).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load, refreshKey]);

  async function saveItem(code, patch) {
    await api.colormaq.contagens.setItem(id, code, patch);
    await load();
  }

  async function changeStatus(status) {
    setChangingStatus(true);
    setError('');
    try {
      await api.colormaq.contagens.update(id, { status });
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
        {contagem.titulo}
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
        <button style={styles.button('ghost')} onClick={() => api.colormaq.contagens.exportXlsx(id, 'COLORMAQ_' + contagem.titulo + '.xlsx')}>Exportar Excel</button>
        {canEditReport && podeEditar && (
          <button style={styles.button('primary')} disabled={changingStatus} onClick={() => changeStatus('FINALIZADA')}>Finalizar contagem</button>
        )}
      </div>
      <input style={{ ...styles.input, maxWidth: 300, marginBottom: 12 }} placeholder="Buscar matéria-prima..." value={filter} onChange={(e) => setFilter(e.target.value)} />
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
                <EditableNumberCell width={110} value={i.saldoSistema} disabled={!podeEditar} onSave={(v) => saveItem(i.rawMaterialCode, { saldoSistema: v })} />
              </td>
              <td style={styles.td}>
                {formatNumber(i.saldoInventario)}
                <div style={{ fontSize: 11, color: colors.textMuted, whiteSpace: 'normal' }}>
                  {formatNumber(i.contagemFisica)} pesado + {formatNumber(i.materiaPrimaProcessada)} processado
                </div>
              </td>
              <td style={styles.td}>
                <EditableNumberCell width={100} value={i.notasTransito} disabled={!podeEditar} onSave={(v) => saveItem(i.rawMaterialCode, { notasTransito: v })} />
              </td>
              <td style={styles.td}>{formatNumber(i.divergencia)}</td>
              <td style={styles.td}>{formatPercent(i.divergenciaPercentual)}</td>
              <td style={styles.td}><Badge tone={condicaoTone(i.condicao)}>{i.condicao}</Badge></td>
              <td style={styles.td}>
                <EditableTextCell width={160} value={i.observacao || ''} disabled={!podeEditar} onSave={(v) => saveItem(i.rawMaterialCode, { observacao: v })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ColormaqContagemTab({ perms, isAdmin, selected, onSelect, refreshKey }) {
  const [contagens, reload] = useAsyncList(api.colormaq.contagens.list, []);
  const [showNew, setShowNew] = useState(false);
  const canEdit = perms.colormaq_contagem?.edit;

  return (
    <div>
      <h1 style={styles.h1}>Colormaq — Relatório de Contagem</h1>
      {selected ? (
        <div>
          <button style={{ ...styles.button('ghost'), marginBottom: 12 }} onClick={() => onSelect(null)}>← Voltar para a lista</button>
          <ColormaqContagemDetail id={selected} perms={perms} isAdmin={isAdmin} refreshKey={refreshKey} />
        </div>
      ) : (
        <div>
          {canEdit && !showNew && <button style={styles.button('primary')} onClick={() => setShowNew(true)}>+ Iniciar Contagem</button>}
          {showNew && <div style={{ marginTop: 12 }}><ColormaqNovaContagemForm onCreated={(id) => { setShowNew(false); reload(); onSelect(id); }} /></div>}
          <table style={{ ...styles.table, marginTop: 16 }} className="bp-table-scroll">
            <thead><tr><th style={styles.th}>Data</th><th style={styles.th}>Título</th><th style={styles.th}>Status</th><th style={styles.th}></th></tr></thead>
            <tbody>
              {(contagens || []).map((c) => (
                <tr key={c.id}>
                  <td style={styles.td}>{formatDate(c.data)}</td>
                  <td style={styles.td}>{c.titulo}</td>
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

// -------------------------------------------------------------- Contagem (celular)

export function ColormaqContagemMobileTab({ perms }) {
  const [contagens] = useAsyncList(api.colormaq.contagens.list, []);
  const [contagemId, setContagemId] = useState('');
  const [contagem, setContagem] = useState(null);
  const [modo, setModo] = useState('KG'); // 'KG' (matéria-prima) | 'UN' (produto)
  const [products] = useAsyncList(api.colormaq.products.list, []);
  const [busca, setBusca] = useState('');
  const [selecionado, setSelecionado] = useState(null); // { tipo: 'material'|'produto', code, nome, ... }
  const [lancamentos, setLancamentos] = useState([]);
  const [pecasProduto, setPecasProduto] = useState(0);
  const [valor, setValor] = useState('');

  useEffect(() => { if (contagemId) api.colormaq.contagens.get(contagemId).then(setContagem); else setContagem(null); }, [contagemId]);

  async function selecionarMaterial(item) {
    setSelecionado({ tipo: 'material', code: item.rawMaterialCode, nome: item.nome, unidade: item.unidade });
    setLancamentos(await api.colormaq.contagens.materiaisLancamentos(contagemId, item.rawMaterialCode));
  }
  async function selecionarProduto(p) {
    setSelecionado({ tipo: 'produto', code: p.code, nome: p.nome });
    const [lan, pecas] = await Promise.all([
      api.colormaq.contagens.produtosLancamentos(contagemId, p.code),
      api.colormaq.contagens.pecasProduzidas.list(contagemId),
    ]);
    setLancamentos(lan);
    setPecasProduto((pecas.find((x) => x.productCode === p.code) || { quantidade: 0 }).quantidade);
  }

  async function refresh() {
    if (selecionado.tipo === 'material') {
      const atualizado = await api.colormaq.contagens.get(contagemId);
      setContagem(atualizado);
      setLancamentos(await api.colormaq.contagens.materiaisLancamentos(contagemId, selecionado.code));
    } else {
      const [lan, pecas] = await Promise.all([
        api.colormaq.contagens.produtosLancamentos(contagemId, selecionado.code),
        api.colormaq.contagens.pecasProduzidas.list(contagemId),
      ]);
      setLancamentos(lan);
      setPecasProduto((pecas.find((x) => x.productCode === selecionado.code) || { quantidade: 0 }).quantidade);
    }
  }

  async function adicionar() {
    if (valor.trim() === '') return;
    const v = parseDecimal(valor);
    if (selecionado.tipo === 'material') await api.colormaq.contagens.addMaterialLancamento(contagemId, selecionado.code, v);
    else await api.colormaq.contagens.addProdutoLancamento(contagemId, selecionado.code, v);
    setValor('');
    await refresh();
  }

  async function remover(lancamentoId) {
    if (selecionado.tipo === 'material') await api.colormaq.contagens.removeMaterialLancamento(contagemId, selecionado.code, lancamentoId);
    else await api.colormaq.contagens.removeProdutoLancamento(contagemId, selecionado.code, lancamentoId);
    await refresh();
  }

  const itensMaterial = contagem ? contagem.itens.filter((i) => !busca || i.rawMaterialCode.toLowerCase().includes(busca.toLowerCase()) || i.nome.toLowerCase().includes(busca.toLowerCase())) : [];
  const itensProduto = (products || []).filter((p) => !busca || p.code.toLowerCase().includes(busca.toLowerCase()) || p.nome.toLowerCase().includes(busca.toLowerCase()));
  const finalizada = contagem?.status === 'FINALIZADA';
  const podeContar = perms.colormaq_contagem_mobile?.edit && !finalizada;
  const totalLancado = lancamentos.reduce((sum, l) => sum + Number(l.valor), 0);

  return (
    <div style={styles.mobileScreen}>
      <h1 style={styles.h1}>Colormaq — Contagem</h1>
      {!perms.colormaq_contagem_mobile?.edit && <Banner tone="warning">Você não tem permissão para lançar contagem.</Banner>}

      <Field label="Contagem">
        <select style={styles.select} value={contagemId} onChange={(e) => { setContagemId(e.target.value); setSelecionado(null); }}>
          <option value="">Selecione...</option>
          {(contagens || []).map((c) => <option key={c.id} value={c.id}>{formatDate(c.data)} — {c.titulo} — {STATUS_LABELS[c.status] || c.status}</option>)}
        </select>
      </Field>

      {contagem && finalizada && <Banner tone="success">Essa contagem foi finalizada — só é possível consultar o que já foi contado.</Banner>}

      {contagem && !selecionado && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button type="button" style={styles.button(modo === 'KG' ? 'primary' : 'ghost')} onClick={() => { setModo('KG'); setBusca(''); }}>KG — Matéria-prima</button>
            <button type="button" style={styles.button(modo === 'UN' ? 'primary' : 'ghost')} onClick={() => { setModo('UN'); setBusca(''); }}>UN — Produto (peça)</button>
          </div>
          <input style={styles.input} placeholder={modo === 'KG' ? 'Buscar matéria-prima...' : 'Buscar produto...'} value={busca} onChange={(e) => setBusca(e.target.value)} />
          <div style={{ marginTop: 12, display: 'grid', gap: 8, maxHeight: 480, overflowY: 'auto' }}>
            {modo === 'KG' && itensMaterial.map((i) => (
              <button key={i.rawMaterialCode} style={{ ...styles.button('ghost'), textAlign: 'left', display: 'flex', justifyContent: 'space-between' }} onClick={() => selecionarMaterial(i)}>
                <span>{i.rawMaterialCode} — {i.nome}</span>
                <span style={{ color: colors.textMuted }}>{formatNumber(i.saldoInventario)} {i.unidade}</span>
              </button>
            ))}
            {modo === 'UN' && itensProduto.map((p) => (
              <button key={p.code} style={{ ...styles.button('ghost'), textAlign: 'left' }} onClick={() => selecionarProduto(p)}>
                {p.code} — {p.nome}
              </button>
            ))}
          </div>
        </div>
      )}

      {selecionado && (
        <div style={{ marginTop: 16 }}>
          <button style={styles.button('ghost')} onClick={() => setSelecionado(null)}>← Buscar outro {selecionado.tipo === 'material' ? 'material' : 'produto'}</button>
          <div style={{ ...styles.card, marginTop: 12, textAlign: 'center' }}>
            <div style={{ fontWeight: 700 }}>{selecionado.code} — {selecionado.nome}</div>
            {selecionado.tipo === 'produto' && (
              <>
                <div style={{ ...styles.bigNumber, marginTop: 12 }}>{formatNumber(pecasProduto)}</div>
                <div style={{ color: colors.textMuted, fontSize: 12 }}>peças produzidas até agora — alimenta a Explosão</div>
              </>
            )}
            {selecionado.tipo === 'material' && (
              <div style={{ color: colors.textMuted, fontSize: 12, marginTop: 8 }}>Unidade: {selecionado.unidade}</div>
            )}
          </div>

          {podeContar && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input style={{ ...styles.input, fontSize: 20, textAlign: 'center' }} type="text"
                  placeholder={selecionado.tipo === 'material' ? '+ valor em KG' : '+ peças (UN)'} value={valor} onChange={(e) => setValor(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') adicionar(); }} />
                <button style={styles.button('primary')} onClick={adicionar}>Somar</button>
              </div>
            </div>
          )}

          <h3 style={{ ...styles.h2, marginTop: 20 }}>Lançamentos {lancamentos.length > 0 && `(total: ${formatNumber(totalLancado)})`}</h3>
          {lancamentos.length === 0 && <p style={{ color: colors.textMuted, fontSize: 13 }}>Nenhum lançamento ainda.</p>}
          <div style={{ display: 'grid', gap: 8 }}>
            {lancamentos.map((l) => (
              <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '8px 12px' }}>
                <span>
                  {formatNumber(l.valor)} {selecionado.tipo === 'material' ? selecionado.unidade : 'un.'}
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
