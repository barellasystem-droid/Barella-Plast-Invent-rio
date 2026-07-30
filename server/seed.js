const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./db');
const { DEFAULT_PERMISSIONS } = require('./constants');

async function seedUsers() {
  const { rows } = await db.query('SELECT COUNT(*) FROM users');
  if (Number(rows[0].count) > 0) {
    console.log('[seed] usuários já existem, pulando.');
    return;
  }
  const demoUsers = [
    { username: 'admin', password: 'admin123', name: 'Administrador', role: 'admin' },
    { username: 'estoque', password: 'estoque123', name: 'Estoque', role: 'estoque' },
    { username: 'contagem', password: 'contagem123', name: 'Contagem', role: 'contagem' },
  ];
  for (const u of demoUsers) {
    await db.query(
      'INSERT INTO users (id, username, password_hash, name, role) VALUES ($1, $2, $3, $4, $5)',
      [crypto.randomUUID(), u.username, bcrypt.hashSync(u.password, 10), u.name, u.role]
    );
  }
  console.log('[seed] usuários de demonstração criados:', demoUsers.map((u) => u.username).join(', '));
}

async function seedPermissions() {
  for (const [tabId, cfg] of Object.entries(DEFAULT_PERMISSIONS)) {
    const allRoles = new Set([...cfg.view, ...cfg.edit]);
    for (const role of allRoles) {
      const canView = cfg.view.includes(role) ? 1 : 0;
      const canEdit = cfg.edit.includes(role) ? 1 : 0;
      await db.query(
        `INSERT INTO permissions (tab_id, role, can_view, can_edit) VALUES ($1, $2, $3, $4)
         ON CONFLICT (tab_id, role) DO NOTHING`,
        [tabId, role, canView, canEdit]
      );
    }
  }
  console.log('[seed] permissões padrão aplicadas.');
}

async function main() {
  await db.ready;
  await seedUsers();
  await seedPermissions();
  await db.pool.end();
}

main().catch((err) => {
  console.error('[seed] falhou:', err);
  process.exit(1);
});
