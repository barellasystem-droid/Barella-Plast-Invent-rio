export const colors = {
  sidebarBg: '#15181B',
  sidebarText: '#B8BCC2',
  sidebarTextActive: '#FFFFFF',
  bg: '#EDEFEF',
  surface: '#FFFFFF',
  border: '#DADDE1',
  text: '#1B1E21',
  textMuted: '#6B7075',
  accent: '#E8A324',
  danger: '#D0453C',
  success: '#2E8B57',
  warning: '#C97A1A',
};

export const styles = {
  app: { display: 'flex', minHeight: '100vh', background: colors.bg, fontFamily: 'var(--font-body)', color: colors.text },
  sidebar: { width: 240, background: colors.sidebarBg, color: colors.sidebarText, display: 'flex', flexDirection: 'column', padding: '20px 0', flexShrink: 0 },
  sidebarBrand: { fontFamily: 'var(--font-display)', color: '#fff', fontSize: 18, fontWeight: 700, padding: '0 20px 20px' },
  sidebarLink: (active) => ({
    display: 'block',
    padding: '10px 20px',
    color: active ? colors.sidebarTextActive : colors.sidebarText,
    background: active ? 'rgba(232,163,36,0.15)' : 'transparent',
    borderLeft: active ? `3px solid ${colors.accent}` : '3px solid transparent',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: active ? 600 : 400,
  }),
  main: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', background: colors.surface, borderBottom: `1px solid ${colors.border}` },
  content: { padding: 24, flex: 1, overflowX: 'auto' },
  card: { background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 20, marginBottom: 20 },
  h1: { fontFamily: 'var(--font-display)', fontSize: 22, margin: '0 0 16px' },
  h2: { fontFamily: 'var(--font-display)', fontSize: 16, margin: '0 0 12px' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 10px', borderBottom: `2px solid ${colors.border}`, color: colors.textMuted, fontWeight: 600, whiteSpace: 'nowrap' },
  td: { padding: '8px 10px', borderBottom: `1px solid ${colors.border}`, whiteSpace: 'nowrap' },
  input: { padding: '8px 10px', border: `1px solid ${colors.border}`, borderRadius: 6, fontSize: 14, fontFamily: 'inherit', width: '100%' },
  select: { padding: '8px 10px', border: `1px solid ${colors.border}`, borderRadius: 6, fontSize: 14, fontFamily: 'inherit', width: '100%', background: '#fff' },
  label: { display: 'block', fontSize: 12, color: colors.textMuted, marginBottom: 4, fontWeight: 600 },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 },
  button: (variant = 'default') => {
    const base = { padding: '9px 16px', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer', border: '1px solid transparent' };
    if (variant === 'primary') return { ...base, background: colors.accent, color: '#1B1E21' };
    if (variant === 'danger') return { ...base, background: '#fff', color: colors.danger, border: `1px solid ${colors.danger}` };
    if (variant === 'ghost') return { ...base, background: 'transparent', color: colors.text, border: `1px solid ${colors.border}` };
    return { ...base, background: colors.text, color: '#fff' };
  },
  badge: (tone = 'default') => {
    const tones = {
      default: { bg: '#E4E6E8', fg: colors.textMuted },
      success: { bg: '#E4F3E9', fg: colors.success },
      danger: { bg: '#FBE6E4', fg: colors.danger },
      warning: { bg: '#FCEFDA', fg: colors.warning },
    };
    const t = tones[tone] || tones.default;
    return { display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: t.bg, color: t.fg };
  },
  bigNumber: { fontFamily: 'var(--font-mono)', fontSize: 32, fontWeight: 600 },
  mobileScreen: { maxWidth: 480, margin: '0 auto' },
};

export function GlobalStyle() {
  return (
    <style>{`
      .bp-sidebar-backdrop { display: none; }
      @media (max-width: 900px) {
        .bp-sidebar {
          position: fixed; top: 0; left: -260px; height: 100vh; z-index: 60;
          transition: left 0.2s ease;
        }
        .bp-sidebar.open { left: 0; }
        .bp-sidebar-backdrop.open {
          display: block; position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 50;
        }
        .bp-menu-btn { display: inline-flex !important; }
      }
      @media (min-width: 901px) {
        .bp-menu-btn { display: none !important; }
      }
      /* Tabelas largas (ex: Relatório de Contagem) ganham a própria caixa de
         rolagem — horizontal E vertical, com altura limitada — em vez de
         crescer com a página inteira. Assim a barra de rolagem horizontal
         fica sempre visível perto do topo, sem precisar descer até o fim de
         uma tabela com dezenas de linhas para conseguir usá-la. */
      table.bp-table-scroll {
        display: block;
        overflow: auto;
        white-space: nowrap;
        max-width: 100%;
        max-height: 65vh;
      }
      table.bp-table-scroll thead {
        position: sticky;
        top: 0;
        z-index: 1;
      }
      table.bp-table-scroll thead th {
        background: #fff;
      }
      @media (max-width: 600px) {
        .bp-content { padding: 14px !important; }
        .bp-form-grid { grid-template-columns: 1fr !important; }
      }
      input, select, textarea, button { font-family: inherit; }
      table { font-variant-numeric: tabular-nums; }
    `}</style>
  );
}
