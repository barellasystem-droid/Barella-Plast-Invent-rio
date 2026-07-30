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
  `);
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
