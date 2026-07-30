const jwt = require('jsonwebtoken');
const db = require('./db');

const DEV_SECRET = 'dev-only-insecure-secret-troque-em-producao';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET não definida. Defina uma variável de ambiente longa e aleatória antes de rodar em produção.');
}
if (!process.env.JWT_SECRET) {
  console.warn('[auth] JWT_SECRET não definida — usando segredo de desenvolvimento inseguro. NÃO use isso em produção.');
}
const SECRET = process.env.JWT_SECRET || DEV_SECRET;

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, name: user.name },
    SECRET,
    { expiresIn: '12h' }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
  }
}

// Fecha o acesso de contas ainda não aprovadas (papel 'pendente') a qualquer
// rota "qualquer usuário autenticado pode ver" — sem isso, uma conta recém
// criada e ainda não aprovada poderia ler dados via chamada direta à API
// mesmo com a interface escondendo os menus.
function blockPending(req, res, next) {
  if (req.user && req.user.role === 'pendente') {
    return res.status(403).json({ error: 'Seu acesso ainda não foi aprovado por um administrador.' });
  }
  next();
}

function requireView(tabId) {
  return async function (req, res, next) {
    const { rows } = await db.query(
      'SELECT can_view FROM permissions WHERE tab_id = $1 AND role = $2',
      [tabId, req.user.role]
    );
    if (!rows.length || !rows[0].can_view) {
      return res.status(403).json({ error: `Sem permissão para ver "${tabId}".` });
    }
    next();
  };
}

function requireEdit(tabId) {
  return async function (req, res, next) {
    const { rows } = await db.query(
      'SELECT can_edit FROM permissions WHERE tab_id = $1 AND role = $2',
      [tabId, req.user.role]
    );
    if (!rows.length || !rows[0].can_edit) {
      return res.status(403).json({ error: `Sem permissão para editar "${tabId}".` });
    }
    next();
  };
}

// Algumas rotas de leitura servem duas telas com permissões diferentes (ex:
// lista de itens da contagem é usada tanto pelo relatório completo quanto
// pela tela mobile de contagem física) — libera se o papel tiver "ver" em
// qualquer uma das abas informadas.
function requireViewAny(tabIds) {
  return async function (req, res, next) {
    const { rows } = await db.query(
      `SELECT 1 FROM permissions WHERE role = $1 AND tab_id = ANY($2::text[]) AND can_view = 1 LIMIT 1`,
      [req.user.role, tabIds]
    );
    if (!rows.length) {
      return res.status(403).json({ error: `Sem permissão para ver "${tabIds.join('" ou "')}".` });
    }
    next();
  };
}

module.exports = { signToken, requireAuth, blockPending, requireView, requireEdit, requireViewAny, SECRET };
