const crypto = require('crypto');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não definida. Configure a connection string do Postgres (Supabase) antes de iniciar.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS permissions (
      tab_id TEXT NOT NULL,
      role TEXT NOT NULL,
      can_view INTEGER NOT NULL DEFAULT 0,
      can_edit INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (tab_id, role)
    );

    CREATE TABLE IF NOT EXISTS raw_materials (
      code TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      unidade TEXT NOT NULL DEFAULT 'KG',
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS products (
      code TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS product_materials (
      id TEXT PRIMARY KEY,
      product_code TEXT NOT NULL REFERENCES products(code) ON DELETE CASCADE,
      raw_material_code TEXT NOT NULL REFERENCES raw_materials(code) ON DELETE RESTRICT,
      consumo_unitario DOUBLE PRECISION NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_product_materials_product ON product_materials(product_code);
    CREATE INDEX IF NOT EXISTS idx_product_materials_material ON product_materials(raw_material_code);

    CREATE TABLE IF NOT EXISTS product_stock (
      product_code TEXT PRIMARY KEY REFERENCES products(code) ON DELETE CASCADE,
      quantidade DOUBLE PRECISION NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT now(),
      updated_by TEXT
    );

    CREATE TABLE IF NOT EXISTS raw_material_virgin_stock (
      raw_material_code TEXT PRIMARY KEY REFERENCES raw_materials(code) ON DELETE CASCADE,
      quantidade DOUBLE PRECISION NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT now(),
      updated_by TEXT
    );

    CREATE TABLE IF NOT EXISTS blends (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    -- Componentes de uma mistura, na ordem em que são retirados do total (ver
    -- server/calc.js). "percentual" é a fração retirada do que sobrou até
    -- aqui (não do total da mistura) — reproduz o jeito em que a planilha
    -- original encadeia os componentes (ex: EXPLOSÃO!V56 = T56*1.5%, onde T56
    -- já é o restante depois de tirar U56 = S56*10%). O último componente de
    -- cada mistura tem percentual NULL: ele fica com o que sobrar.
    CREATE TABLE IF NOT EXISTS blend_components (
      id TEXT PRIMARY KEY,
      blend_id TEXT NOT NULL REFERENCES blends(id) ON DELETE CASCADE,
      raw_material_code TEXT NOT NULL REFERENCES raw_materials(code) ON DELETE RESTRICT,
      percentual DOUBLE PRECISION,
      ordem INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_blend_components_blend ON blend_components(blend_id);

    CREATE TABLE IF NOT EXISTS blend_state_quantities (
      blend_id TEXT NOT NULL REFERENCES blends(id) ON DELETE CASCADE,
      estado TEXT NOT NULL CHECK (estado IN ('BORRA','MISTURA','GALHO','PECA','VARREDURA','MOIDO','SUCATA','MAQUINA')),
      quantidade DOUBLE PRECISION NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT now(),
      updated_by TEXT,
      PRIMARY KEY (blend_id, estado)
    );

    -- "data" é sempre o dia em que a contagem foi iniciada, no fuso de
    -- Brasília (nunca informado pelo cliente) — contagem não pode ser feita
    -- com data retroativa nem futura. Uma contagem com data diferente de hoje
    -- vira só consulta (ver server/routes/contagens.js, assertContagemDeHoje).
    CREATE TABLE IF NOT EXISTS contagens (
      id TEXT PRIMARY KEY,
      titulo TEXT NOT NULL,
      fornecedor TEXT,
      periodo TEXT,
      status TEXT NOT NULL DEFAULT 'ABERTA',
      data DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),
      created_at TIMESTAMPTZ DEFAULT now(),
      created_by TEXT
    );

    CREATE TABLE IF NOT EXISTS contagem_itens (
      id TEXT PRIMARY KEY,
      contagem_id TEXT NOT NULL REFERENCES contagens(id) ON DELETE CASCADE,
      raw_material_code TEXT NOT NULL REFERENCES raw_materials(code) ON DELETE RESTRICT,
      saldo_sistema DOUBLE PRECISION NOT NULL DEFAULT 0,
      saldo_sistema_origem TEXT NOT NULL DEFAULT 'manual' CHECK (saldo_sistema_origem IN ('manual','upload')),
      notas_transito DOUBLE PRECISION NOT NULL DEFAULT 0,
      observacao TEXT,
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (contagem_id, raw_material_code)
    );
    CREATE INDEX IF NOT EXISTS idx_contagem_itens_contagem ON contagem_itens(contagem_id);

    CREATE TABLE IF NOT EXISTS contagem_lancamentos (
      id TEXT PRIMARY KEY,
      contagem_item_id TEXT NOT NULL REFERENCES contagem_itens(id) ON DELETE CASCADE,
      valor DOUBLE PRECISION NOT NULL,
      criado_por TEXT,
      criado_em TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_contagem_lancamentos_item ON contagem_lancamentos(contagem_item_id);

    -- Cada lançamento é ou um peso (na unidade da matéria-prima, ex: KG) ou uma
    -- quantidade (contagem por unidade/saco/peça) — são dois totais mantidos
    -- separados (não convertidos um no outro), porque nem toda contagem tem
    -- como saber o peso de cada unidade contada. Só "peso" entra no cálculo do
    -- Saldo do Inventário (mesma unidade do restante do sistema); "quantidade"
    -- é só informativo.
    ALTER TABLE contagem_lancamentos ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'PESO';
    ALTER TABLE contagem_lancamentos DROP CONSTRAINT IF EXISTS contagem_lancamentos_tipo_check;
    ALTER TABLE contagem_lancamentos ADD CONSTRAINT contagem_lancamentos_tipo_check
      CHECK (tipo IN ('PESO','QUANTIDADE'));

    -- Cadastro público (auto-registro): quem se cadastra pela tela de login
    -- entra com o papel 'pendente' e só ganha acesso de verdade quando um
    -- administrador troca o papel dele (ver server/routes/auth.js e
    -- server/routes/users.js). ADD COLUMN IF NOT EXISTS porque users já pode
    -- existir em produção com dados reais.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

    -- Adiciona o estado "Peça" (quanto do lote de uma mistura vira peça boa,
    -- não só refugo). CREATE TABLE IF NOT EXISTS não altera o CHECK de uma
    -- tabela que já existe, por isso troca a constraint explicitamente.
    ALTER TABLE blend_state_quantities DROP CONSTRAINT IF EXISTS blend_state_quantities_estado_check;
    ALTER TABLE blend_state_quantities ADD CONSTRAINT blend_state_quantities_estado_check
      CHECK (estado IN ('BORRA','MISTURA','GALHO','PECA','VARREDURA','MOIDO','SUCATA','MAQUINA'));

    -- Contagens criadas antes dessa coluna existir ficam com a data do dia em
    -- que essa migração rodou (não temos como saber retroativamente quando
    -- cada uma foi de fato contada).
    ALTER TABLE contagens ADD COLUMN IF NOT EXISTS data DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date);

    -- Estoque de produto, estoque virgem e quantidade por estado da mistura
    -- passam a ser um snapshot por contagem (período), não mais um valor
    -- único e sempre atual — cada contagem preserva sua própria "foto" desses
    -- números, permitindo consultar o histórico depois. As tabelas antigas
    -- (product_stock, raw_material_virgin_stock, blend_state_quantities)
    -- ficam paradas, sem uso — ver migrateToContagemScoped() logo abaixo, que
    -- copia o que existia nelas para uma contagem "base" na primeira vez que
    -- essa versão roda.
    CREATE TABLE IF NOT EXISTS contagem_product_stock (
      contagem_id TEXT NOT NULL REFERENCES contagens(id) ON DELETE CASCADE,
      product_code TEXT NOT NULL REFERENCES products(code) ON DELETE CASCADE,
      quantidade DOUBLE PRECISION NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT now(),
      updated_by TEXT,
      PRIMARY KEY (contagem_id, product_code)
    );

    CREATE TABLE IF NOT EXISTS contagem_virgin_stock (
      contagem_id TEXT NOT NULL REFERENCES contagens(id) ON DELETE CASCADE,
      raw_material_code TEXT NOT NULL REFERENCES raw_materials(code) ON DELETE CASCADE,
      quantidade DOUBLE PRECISION NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT now(),
      updated_by TEXT,
      PRIMARY KEY (contagem_id, raw_material_code)
    );

    CREATE TABLE IF NOT EXISTS contagem_blend_state_quantities (
      contagem_id TEXT NOT NULL REFERENCES contagens(id) ON DELETE CASCADE,
      blend_id TEXT NOT NULL REFERENCES blends(id) ON DELETE CASCADE,
      estado TEXT NOT NULL CHECK (estado IN ('BORRA','MISTURA','GALHO','PECA','VARREDURA','MOIDO','SUCATA','MAQUINA')),
      quantidade DOUBLE PRECISION NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT now(),
      updated_by TEXT,
      PRIMARY KEY (contagem_id, blend_id, estado)
    );
  `);
  await addOnUpdateCascades();
  await migrateToContagemScoped();
}

// Permite editar o código de uma matéria-prima ou produto depois de
// cadastrado: por padrão o Postgres rejeita a mudança se existir alguma
// linha referenciando o código antigo, então toda FK que aponta para
// raw_materials(code)/products(code) precisa de ON UPDATE CASCADE (o nome da
// constraint é descoberto em runtime em vez de fixo, já que pode variar
// conforme quando a tabela foi criada).
async function addOnUpdateCascades() {
  const fks = [
    ['product_materials', 'product_code', 'products', 'code', 'CASCADE'],
    ['product_materials', 'raw_material_code', 'raw_materials', 'code', 'RESTRICT'],
    ['product_stock', 'product_code', 'products', 'code', 'CASCADE'],
    ['raw_material_virgin_stock', 'raw_material_code', 'raw_materials', 'code', 'CASCADE'],
    ['blend_components', 'raw_material_code', 'raw_materials', 'code', 'RESTRICT'],
    ['contagem_itens', 'raw_material_code', 'raw_materials', 'code', 'RESTRICT'],
    ['contagem_product_stock', 'product_code', 'products', 'code', 'CASCADE'],
    ['contagem_virgin_stock', 'raw_material_code', 'raw_materials', 'code', 'CASCADE'],
  ];
  for (const [table, column, refTable, refColumn, onDelete] of fks) {
    const { rows } = await pool.query(
      `SELECT con.conname
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
       WHERE con.contype = 'f' AND rel.relname = $1 AND att.attname = $2`,
      [table, column]
    );
    for (const row of rows) {
      await pool.query(`ALTER TABLE ${table} DROP CONSTRAINT ${row.conname}`);
    }
    await pool.query(
      `ALTER TABLE ${table} ADD CONSTRAINT ${table}_${column}_fkey
       FOREIGN KEY (${column}) REFERENCES ${refTable}(${refColumn}) ON DELETE ${onDelete} ON UPDATE CASCADE`
    );
  }
}

// Roda uma única vez (fica sem efeito depois que já existe pelo menos uma
// linha em contagem_product_stock): copia os valores que estavam nas tabelas
// globais antigas para dentro de uma contagem "Dados importados da planilha",
// preservando o que já tinha sido cadastrado/importado antes desse recurso
// existir, em vez de simplesmente perder esses números.
async function migrateToContagemScoped() {
  const { rows: already } = await pool.query('SELECT 1 FROM contagem_product_stock LIMIT 1');
  if (already.length) return;
  const { rows: oldStock } = await pool.query('SELECT COUNT(*)::int AS n FROM product_stock');
  const { rows: oldVirgin } = await pool.query('SELECT COUNT(*)::int AS n FROM raw_material_virgin_stock');
  const { rows: oldStates } = await pool.query('SELECT COUNT(*)::int AS n FROM blend_state_quantities');
  if (!oldStock[0].n && !oldVirgin[0].n && !oldStates[0].n) return;

  const baselineId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO contagens (id, titulo, status, data) VALUES ($1, 'Dados importados da planilha', 'FECHADA', ((now() AT TIME ZONE 'America/Sao_Paulo')::date))`,
    [baselineId]
  );
  await pool.query(
    `INSERT INTO contagem_product_stock (contagem_id, product_code, quantidade, updated_at, updated_by)
     SELECT $1, product_code, quantidade, updated_at, updated_by FROM product_stock`,
    [baselineId]
  );
  await pool.query(
    `INSERT INTO contagem_virgin_stock (contagem_id, raw_material_code, quantidade, updated_at, updated_by)
     SELECT $1, raw_material_code, quantidade, updated_at, updated_by FROM raw_material_virgin_stock`,
    [baselineId]
  );
  await pool.query(
    `INSERT INTO contagem_blend_state_quantities (contagem_id, blend_id, estado, quantidade, updated_at, updated_by)
     SELECT $1, blend_id, estado, quantidade, updated_at, updated_by FROM blend_state_quantities`,
    [baselineId]
  );
  // A contagem base também ganha contagem_itens (mesmo padrão de POST /contagens
  // em server/routes/contagens.js) para poder aparecer normalmente no
  // Relatório de Contagem, se alguém for conferir.
  const { rows: materials } = await pool.query('SELECT code FROM raw_materials');
  for (const m of materials) {
    await pool.query(
      'INSERT INTO contagem_itens (id, contagem_id, raw_material_code) VALUES ($1, $2, $3)',
      [crypto.randomUUID(), baselineId, m.code]
    );
  }
}

// Roda uma vez por cold start (o módulo fica em cache); todo lugar que usa o
// pool aguarda essa promise antes da primeira consulta (ver server/app.js).
const ready = init();

// Executa uma função dentro de uma transação, usando uma única conexão do
// pool — necessário para operações "replace all" (BOM do produto, estados da
// mistura) que fazem DELETE + vários INSERT e precisam ser tudo ou nada.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, ready, query: (text, params) => pool.query(text, params), withTransaction };
