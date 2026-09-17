const crypto = require('crypto');
const { Pool } = require('pg');
const { SUPPLIERS } = require('./suppliers');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não definida. Configure a connection string do Postgres (Supabase) antes de iniciar.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

// Chave arbitrária (só precisa ser única dentro desse banco) para o
// advisory lock que serializa a inicialização — ver init() abaixo.
const INIT_LOCK_KEY = 727390100;

async function init() {
  const client = await pool.connect();
  try {
    // Vercel pode subir mais de uma função ao mesmo tempo (vários "cold
    // start" simultâneos, comum logo depois de um deploy ou com vários
    // usuários acessando junto) — cada uma rodava esse bloco inteiro de
    // CREATE TABLE/ALTER TABLE em paralelo, disputando lock de catálogo
    // (tabelas/constraints) uma com a outra, e o Postgres podia derrubar uma
    // delas com "deadlock detected" — foi isso que travou o login depois do
    // deploy da Colormaq (mais tabelas/FKs novas de uma vez aumentaram a
    // chance de colisão).
    //
    // O DATABASE_URL aponta pro Transaction pooler do Supabase (PgBouncer em
    // modo transaction) — um advisory lock de SESSÃO (pg_advisory_lock/
    // pg_advisory_unlock) não é seguro aqui: fora de uma transação explícita,
    // o PgBouncer pode reatribuir a conexão física do Postgres para outro
    // cliente a cada statement, então o lock() e o unlock() podem acabar
    // rodando em conexões físicas diferentes — o unlock não solta nada, e o
    // lock fica preso pra sempre, travando todo cold start seguinte (pior que
    // o bug original). pg_advisory_xact_lock (preso à TRANSAÇÃO, não à
    // sessão) resolve isso: com tudo dentro de um BEGIN...COMMIT explícito na
    // mesma conexão, o PgBouncer mantém essa conexão fixa até o COMMIT, e o
    // lock é solto sozinho no COMMIT/ROLLBACK — sem unlock manual.
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [INIT_LOCK_KEY]);
    await initSchema(client);
    await runOnce(client, 'fix_legacy_integer_columns_v1', fixLegacyIntegerColumns);
    await runOnce(client, 'add_on_update_cascades_v1', addOnUpdateCascades);
    await runOnce(client, 'seed_colormaq_permissions_v1', seedSupplierPermissions);
    // v2 (não v1 de novo): quando Cadence/Inplast/Amvox entraram, bancos que
    // já tinham rodado a v1 (só Colormaq) não ganhariam as permissões dos
    // fornecedores novos — o runOnce da v1 já estava marcado como feito e
    // pularia de novo. Sempre que uma leva nova de fornecedores genéricos
    // entrar, criar mais uma versão aqui (v3, v4...) em vez de reusar o nome.
    await runOnce(client, 'seed_supplier_permissions_v2', seedSupplierPermissions);
    await migrateToContagemScoped(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function initSchema(client) {
  await client.query(`
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
    -- Brasília (nunca informado pelo cliente). Fica editável em qualquer dia
    -- enquanto o status não for FINALIZADA (ver server/routes/contagens.js,
    -- assertContagemAberta).
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

    -- Marca migrações de correção (fixLegacyIntegerColumns, addOnUpdateCascades)
    -- já aplicadas, para runOnce() poder pular o trabalho pesado delas depois
    -- da primeira vez — ver runOnce() logo abaixo.
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT now()
    );

  `);
  // ------------------------------------------------------------------
  // Fornecedores "genéricos" (Colormaq, Cadence, Inplast, Amvox — ver
  // server/suppliers.js): mesmo molde para todos, uma cópia do schema por
  // fornecedor, prefixada (ex: colormaq_raw_materials, cadence_raw_materials
  // ...). Nenhuma tabela dessas referencia ou é referenciada por uma tabela
  // da Mondial (tabelas acima), e nenhuma tabela da Mondial foi alterada
  // para esses fornecedores entrarem — ver server/supplierRoutes.js e
  // server/supplierCalc.js, que também não tocam em nada usado pela
  // Mondial. Mesmo banco de dados, estrutura isolada por design (pedido
  // explícito do cliente, primeiro pra Colormaq, depois generalizado).
  //
  // Diferenças do modelo da Mondial (planilha de referência original:
  // COLORMAQ.xlsx, uma aba por data de contagem — os fornecedores seguintes
  // usam o mesmo molde sem planilha própria, por pedido do cliente):
  //   - Cada produto tem só 2 matérias-primas na receita (resina +
  //     masterbatch) — mas "<prefixo>_product_materials" não trava nisso, é
  //     uma tabela igual a product_materials, aberta a mudar depois.
  //   - "Mistura" só tem 2 estados (MISTURA e MOÍDO), não os 8 da Mondial.
  //   - O papel de cada componente da mistura é explícito (RESINA ou
  //     MASTERBATCH) em vez de inferido por ordem/percentual nulo — o
  //     percentual de diluição do masterbatch (quanto da mistura reciclada
  //     é masterbatch, ex: 2% no grafite / 3% no branco) não fica guardado
  //     separado: é sempre calculado a partir do próprio consumo_unitario
  //     cadastrado em "<prefixo>_product_materials" (G e M da planilha
  //     original da Colormaq), para nunca ficar dessincronizado — mudar a
  //     receita do produto já muda esse percentual automaticamente, sem
  //     precisar editar em dois lugares (editável no cadastro do produto).
  //   - "Peças produzidas" é o que entra na Explosão — contagem física em
  //     UN no celular alimenta esse número automaticamente; contagem em KG
  //     alimenta o saldo da matéria-prima diretamente, igual já funciona na
  //     Mondial.
  for (const supplier of SUPPLIERS) {
    await client.query(supplierSchemaSql(supplier.key));
  }
}

// Gera o schema completo de um fornecedor genérico, com todas as tabelas
// prefixadas por "prefix_" — ver o comentário acima de initSchema() para o
// que cada tabela representa. "prefix" nunca vem de entrada de usuário (só
// de server/suppliers.js, uma lista fixa no código), então interpolar
// direto na string SQL aqui é seguro — nomes de tabela não podem ser
// parâmetro ligado ($1) do jeito que valores podem.
function supplierSchemaSql(prefix) {
  const p = prefix;
  return `
    -- "tipo" é fixo por matéria-prima (uma resina é sempre resina, um
    -- masterbatch é sempre masterbatch) — usado pra derivar sozinho o blend
    -- (resina+masterbatch) de cada produto quando o cadastro dele é salvo,
    -- em vez de pedir pra alguém montar isso à mão (ver
    -- server/supplierRoutes.js, syncBlend()). Fica opcional (NULL) porque
    -- nem toda matéria-prima cadastrada precisa entrar numa receita de
    -- produto.
    CREATE TABLE IF NOT EXISTS ${p}_raw_materials (
      code TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      unidade TEXT NOT NULL DEFAULT 'KG',
      tipo TEXT CHECK (tipo IN ('RESINA','MASTERBATCH')),
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ${p}_products (
      code TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ${p}_product_materials (
      id TEXT PRIMARY KEY,
      product_code TEXT NOT NULL REFERENCES ${p}_products(code) ON DELETE CASCADE ON UPDATE CASCADE,
      raw_material_code TEXT NOT NULL REFERENCES ${p}_raw_materials(code) ON DELETE RESTRICT ON UPDATE CASCADE,
      consumo_unitario DOUBLE PRECISION NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_${p}_product_materials_product ON ${p}_product_materials(product_code);
    CREATE INDEX IF NOT EXISTS idx_${p}_product_materials_material ON ${p}_product_materials(raw_material_code);

    -- Um "blend" agrupa os produtos que compartilham a mesma dupla
    -- resina+masterbatch — é nessa dupla que a mistura/moído reciclado é
    -- lançado e depois repartido de volta entre resina e masterbatch.
    -- "papel" substitui o percentual/ordem que a Mondial usa: exatamente um
    -- componente RESINA e um MASTERBATCH.
    CREATE TABLE IF NOT EXISTS ${p}_blends (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ${p}_blend_components (
      id TEXT PRIMARY KEY,
      blend_id TEXT NOT NULL REFERENCES ${p}_blends(id) ON DELETE CASCADE,
      raw_material_code TEXT NOT NULL REFERENCES ${p}_raw_materials(code) ON DELETE RESTRICT ON UPDATE CASCADE,
      papel TEXT NOT NULL CHECK (papel IN ('RESINA','MASTERBATCH')),
      UNIQUE (blend_id, papel)
    );
    CREATE INDEX IF NOT EXISTS idx_${p}_blend_components_blend ON ${p}_blend_components(blend_id);

    CREATE TABLE IF NOT EXISTS ${p}_contagens (
      id TEXT PRIMARY KEY,
      titulo TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ABERTA',
      data DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),
      created_at TIMESTAMPTZ DEFAULT now(),
      created_by TEXT
    );

    -- Peças produzidas por produto, snapshot por contagem — equivalente ao
    -- estoque de produto da Mondial (contagem_product_stock), mas aqui o
    -- número é literalmente "quantas peças esse produto produziu nessa
    -- contagem", preenchido tanto pela tela Matéria-Prima Processada
    -- (edição direta) quanto pelos lançamentos em UN do celular (somados
    -- por cima — ver server/supplierCalc.js).
    CREATE TABLE IF NOT EXISTS ${p}_contagem_pecas_produzidas (
      contagem_id TEXT NOT NULL REFERENCES ${p}_contagens(id) ON DELETE CASCADE,
      product_code TEXT NOT NULL REFERENCES ${p}_products(code) ON DELETE CASCADE ON UPDATE CASCADE,
      quantidade DOUBLE PRECISION NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT now(),
      updated_by TEXT,
      PRIMARY KEY (contagem_id, product_code)
    );

    CREATE TABLE IF NOT EXISTS ${p}_contagem_blend_quantities (
      contagem_id TEXT NOT NULL REFERENCES ${p}_contagens(id) ON DELETE CASCADE,
      blend_id TEXT NOT NULL REFERENCES ${p}_blends(id) ON DELETE CASCADE,
      estado TEXT NOT NULL CHECK (estado IN ('MISTURA','MOIDO')),
      quantidade DOUBLE PRECISION NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT now(),
      updated_by TEXT,
      PRIMARY KEY (contagem_id, blend_id, estado)
    );

    -- Relatório de Contagem: mesmo padrão da Mondial (Saldo do Sistema x
    -- Saldo do Inventário x Notas em Trânsito -> Divergência),
    -- reaproveitando computeDivergence de server/calc.js (função pura,
    -- genérica, sem nada específico da Mondial — importar não altera nada).
    CREATE TABLE IF NOT EXISTS ${p}_contagem_itens (
      id TEXT PRIMARY KEY,
      contagem_id TEXT NOT NULL REFERENCES ${p}_contagens(id) ON DELETE CASCADE,
      raw_material_code TEXT NOT NULL REFERENCES ${p}_raw_materials(code) ON DELETE RESTRICT ON UPDATE CASCADE,
      saldo_sistema DOUBLE PRECISION NOT NULL DEFAULT 0,
      saldo_sistema_origem TEXT NOT NULL DEFAULT 'manual' CHECK (saldo_sistema_origem IN ('manual','upload')),
      notas_transito DOUBLE PRECISION NOT NULL DEFAULT 0,
      observacao TEXT,
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (contagem_id, raw_material_code)
    );
    CREATE INDEX IF NOT EXISTS idx_${p}_contagem_itens_contagem ON ${p}_contagem_itens(contagem_id);

    -- Lançamentos da contagem física pelo celular. Ao contrário da Mondial
    -- (onde PESO/QUANTIDADE são só duas unidades do mesmo item contado),
    -- aqui "PESO" conta uma MATÉRIA-PRIMA (pesando o saco de resina) e "UN"
    -- conta um PRODUTO (peça acabada) — por isso raw_material_code e
    -- product_code são mutuamente exclusivos, um deles sempre nulo conforme
    -- o tipo.
    CREATE TABLE IF NOT EXISTS ${p}_contagem_lancamentos (
      id TEXT PRIMARY KEY,
      contagem_id TEXT NOT NULL REFERENCES ${p}_contagens(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL CHECK (tipo IN ('PESO','UN')),
      raw_material_code TEXT REFERENCES ${p}_raw_materials(code) ON DELETE RESTRICT ON UPDATE CASCADE,
      product_code TEXT REFERENCES ${p}_products(code) ON DELETE RESTRICT ON UPDATE CASCADE,
      valor DOUBLE PRECISION NOT NULL,
      criado_por TEXT,
      criado_em TIMESTAMPTZ DEFAULT now(),
      CHECK (
        (tipo = 'PESO' AND raw_material_code IS NOT NULL AND product_code IS NULL) OR
        (tipo = 'UN' AND product_code IS NOT NULL AND raw_material_code IS NULL)
      )
    );
    CREATE INDEX IF NOT EXISTS idx_${p}_contagem_lancamentos_contagem ON ${p}_contagem_lancamentos(contagem_id);
    CREATE INDEX IF NOT EXISTS idx_${p}_contagem_lancamentos_material ON ${p}_contagem_lancamentos(raw_material_code);
    CREATE INDEX IF NOT EXISTS idx_${p}_contagem_lancamentos_produto ON ${p}_contagem_lancamentos(product_code);
  `;
}

// Bancos que já existiam antes de um fornecedor genérico entrar não ganham
// as novas linhas de permissions.tab_id sozinhos (DEFAULT_PERMISSIONS só é
// aplicado por server/seed.js, e só numa vez, em banco vazio) — sem isso,
// ninguém (nem admin) veria as abas novas até alguém abrir Permissões e
// marcar na mão. ON CONFLICT DO NOTHING preserva o que um admin já tiver
// editado.
async function seedSupplierPermissions(client) {
  const { DEFAULT_PERMISSIONS } = require('./constants');
  const prefixes = SUPPLIERS.map((s) => `${s.key}_`);
  const supplierTabs = Object.keys(DEFAULT_PERMISSIONS).filter((t) => prefixes.some((p) => t.startsWith(p)));
  for (const tabId of supplierTabs) {
    const cfg = DEFAULT_PERMISSIONS[tabId];
    const allRoles = new Set([...cfg.view, ...cfg.edit]);
    for (const role of allRoles) {
      await client.query(
        `INSERT INTO permissions (tab_id, role, can_view, can_edit) VALUES ($1, $2, $3, $4)
         ON CONFLICT (tab_id, role) DO NOTHING`,
        [tabId, role, cfg.view.includes(role) ? 1 : 0, cfg.edit.includes(role) ? 1 : 0]
      );
    }
  }
}

// fixLegacyIntegerColumns (11 ALTER TABLE) e addOnUpdateCascades (24
// consultas: SELECT + DROP + ADD CONSTRAINT por chave estrangeira) só
// precisam rodar uma vez de verdade — depois disso são só trabalho
// desperdiçado. Sem esse controle, TODO cold start (função nova subindo na
// Vercel) reaplicava as duas de novo, do zero, antes de conseguir responder
// à primeira requisição — é isso que deixava o primeiro clique depois de um
// tempo parado sensivelmente mais lento. Uma tabela com uma linha por
// migração já aplicada (em vez de inspecionar o schema do banco, que já se
// mostrou não confiável atrás do pooler — ver o comentário de
// fixLegacyIntegerColumns) resolve com uma única consulta barata.
async function runOnce(client, name, fn) {
  const { rows } = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
  if (rows.length) return;
  await fn(client);
  await client.query('INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
}

// Essas colunas foram criadas como INTEGER em uma versão bem antiga do
// schema, antes de precisarem guardar casas decimais. "CREATE TABLE IF NOT
// EXISTS" nunca corrige o tipo de uma coluna de uma tabela que já existe —
// só afeta tabela nova — então o banco real ficou preso em INTEIRO mesmo
// depois do código passar a declarar DOUBLE PRECISION aqui. Resultado: um
// valor inteiro (25685) salvava normalmente, mas qualquer decimal (2.2)
// era recusado pelo Postgres ("invalid input syntax for type integer"),
// e a tela dava a impressão de "não salvou"/"zerou depois de sair da tela"
// porque a gravação nunca tinha acontecido de verdade.
async function fixLegacyIntegerColumns(client) {
  const columns = [
    ['product_materials', 'consumo_unitario'],
    ['product_stock', 'quantidade'],
    ['raw_material_virgin_stock', 'quantidade'],
    ['blend_components', 'percentual'],
    ['blend_state_quantities', 'quantidade'],
    ['contagem_itens', 'saldo_sistema'],
    ['contagem_itens', 'notas_transito'],
    ['contagem_lancamentos', 'valor'],
    ['contagem_product_stock', 'quantidade'],
    ['contagem_virgin_stock', 'quantidade'],
    ['contagem_blend_state_quantities', 'quantidade'],
  ];
  // Antes tentava só quando um SELECT prévio em information_schema dizia que
  // a coluna não era double precision ainda — e esse SELECT, por algum
  // motivo (schema/search_path do Supabase, cache do pooler em modo
  // transaction), vinha vazio ou desatualizado em produção: o ALTER nunca
  // rodava de verdade, e o erro "invalid input syntax for type integer"
  // continuou nos logs dias depois desse "fix" já estar publicado. ALTER
  // COLUMN TYPE para o mesmo tipo que a coluna já tem é uma operação sem
  // efeito (Postgres só reescreve a tabela quando o tipo muda de verdade),
  // então é seguro tentar sempre, sem depender daquele SELECT. Cada coluna
  // roda isolada: uma falha (ex: permissão) fica só um log, não derruba
  // `db.ready` — antes uma única coluna travando aqui tirava a API inteira
  // do ar, já que toda rota espera essa promise antes de tocar no banco.
  // Agora roda dentro de uma única transação (ver init()) — um erro num
  // ALTER "envenena" a transação inteira até um ROLLBACK (mesmo capturado
  // aqui em JS com try/catch, o Postgres já marcou a transação como abortada
  // e qualquer comando seguinte, mesmo sem relação nenhuma, falharia com
  // "current transaction is aborted"). SAVEPOINT por coluna preserva o
  // isolamento original: uma falha desfaz só até o savepoint, sem derrubar
  // o resto da migração.
  for (const [table, column] of columns) {
    try {
      await client.query('SAVEPOINT fix_legacy_integer_column');
      await client.query(
        `ALTER TABLE public.${table} ALTER COLUMN ${column} TYPE DOUBLE PRECISION USING ${column}::double precision`
      );
      await client.query('RELEASE SAVEPOINT fix_legacy_integer_column');
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT fix_legacy_integer_column').catch(() => {});
      console.error(`fixLegacyIntegerColumns: falha ao corrigir ${table}.${column}:`, err.message);
    }
  }
}

// Permite editar o código de uma matéria-prima ou produto depois de
// cadastrado: por padrão o Postgres rejeita a mudança se existir alguma
// linha referenciando o código antigo, então toda FK que aponta para
// raw_materials(code)/products(code) precisa de ON UPDATE CASCADE (o nome da
// constraint é descoberto em runtime em vez de fixo, já que pode variar
// conforme quando a tabela foi criada).
async function addOnUpdateCascades(client) {
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
    const { rows } = await client.query(
      `SELECT con.conname
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
       WHERE con.contype = 'f' AND rel.relname = $1 AND att.attname = $2`,
      [table, column]
    );
    for (const row of rows) {
      await client.query(`ALTER TABLE ${table} DROP CONSTRAINT ${row.conname}`);
    }
    await client.query(
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
async function migrateToContagemScoped(client) {
  const { rows: already } = await client.query('SELECT 1 FROM contagem_product_stock LIMIT 1');
  if (already.length) return;
  const { rows: oldStock } = await client.query('SELECT COUNT(*)::int AS n FROM product_stock');
  const { rows: oldVirgin } = await client.query('SELECT COUNT(*)::int AS n FROM raw_material_virgin_stock');
  const { rows: oldStates } = await client.query('SELECT COUNT(*)::int AS n FROM blend_state_quantities');
  if (!oldStock[0].n && !oldVirgin[0].n && !oldStates[0].n) return;

  const baselineId = crypto.randomUUID();
  await client.query(
    `INSERT INTO contagens (id, titulo, status, data) VALUES ($1, 'Dados importados da planilha', 'FECHADA', ((now() AT TIME ZONE 'America/Sao_Paulo')::date))`,
    [baselineId]
  );
  await client.query(
    `INSERT INTO contagem_product_stock (contagem_id, product_code, quantidade, updated_at, updated_by)
     SELECT $1, product_code, quantidade, updated_at, updated_by FROM product_stock`,
    [baselineId]
  );
  await client.query(
    `INSERT INTO contagem_virgin_stock (contagem_id, raw_material_code, quantidade, updated_at, updated_by)
     SELECT $1, raw_material_code, quantidade, updated_at, updated_by FROM raw_material_virgin_stock`,
    [baselineId]
  );
  await client.query(
    `INSERT INTO contagem_blend_state_quantities (contagem_id, blend_id, estado, quantidade, updated_at, updated_by)
     SELECT $1, blend_id, estado, quantidade, updated_at, updated_by FROM blend_state_quantities`,
    [baselineId]
  );
  // A contagem base também ganha contagem_itens (mesmo padrão de POST /contagens
  // em server/routes/contagens.js) para poder aparecer normalmente no
  // Relatório de Contagem, se alguém for conferir.
  const { rows: materials } = await client.query('SELECT code FROM raw_materials');
  for (const m of materials) {
    await client.query(
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
