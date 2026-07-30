# Barella Plast — Sistema de Inventário

Sistema real (backend + banco de dados) para explosão de matéria-prima e
contagem de estoque com o fornecedor — construído a partir da planilha
`INVENTÁRIO Ba.xlsx`. Segue o mesmo padrão do sistema de PCP da Barella Plast
(Node.js + Express + Postgres/Supabase, React, Vercel), mas é um **projeto e
banco de dados totalmente separados** — nenhum dado é compartilhado com o PCP.

## O que tem aqui

- **Backend**: Node.js + Express + Postgres (via `pg`) — Supabase (grátis) ou
  qualquer outro Postgres.
- **Frontend**: React (Vite).
- **Autenticação**: usuário e senha individuais (bcrypt), sessão via token (JWT).
- **Permissões por aba**: tabela `permissions` no banco define, por papel
  (Administrador, Estoque, Contagem), quem pode **ver** e quem pode **editar**
  cada tela. Editável pela própria interface, em Permissões.
- **Explosão de matéria-prima**: a partir da quantidade em estoque de cada
  produto, calcula automaticamente quanto de cada matéria-prima já está
  "produzida" (embutida em produto pronto, em resina virgem separada, ou em
  cada estado de mistura: borra, mistura, galho, varredura, moído, sucata,
  máquina) — mesma lógica da Planilha Mestre original, com os percentuais de
  cada mistura editáveis na tela Explosão.
- **Contagem de inventário com o fornecedor**: `Saldo do Sistema` pode ser
  digitado à mão ou importado de um arquivo XLS/PDF do fornecedor (casando
  pelo código — item não cadastrado é sinalizado e te leva direto para o
  cadastro, voltando depois para a importação). `Saldo do Inventário` é
  contado fisicamente pelo celular: quem conta busca o material, vê a unidade
  certa (kg ou un) e vai somando os valores achados em cada lugar do estoque
  (ex: 20 + 20 + 100...) — o sistema mantém o total corrente e o histórico de
  cada lançamento.

## 1. Instalar (a primeira vez, em qualquer computador)

Pré-requisitos: [Node.js](https://nodejs.org) 18+ e uma connection string de
Postgres em `DATABASE_URL` (ver seção 6 para criar uma grátis no Supabase).

```bash
DATABASE_URL="sua connection string do Postgres" npm run setup
```

Isso instala as dependências do servidor, instala e constrói o frontend
(`web/dist`) e cria as tabelas + usuários de demonstração.

## 2. Importar os dados da planilha original (opcional, mas recomendado)

Evita ter que recadastrar ~110 produtos e ~30 misturas na mão. Lê
`INVENTÁRIO Ba.xlsx` (nesta pasta) e grava produtos, matérias-primas, BOM,
misturas/percentuais e estoque virgem no banco:

```bash
DATABASE_URL="sua connection string do Postgres" npm run import-xlsx
```

Sem `DATABASE_URL`, o mesmo comando só faz a leitura e a validação (compara os
totais recalculados com os já salvos na planilha) sem gravar nada — útil para
conferir antes de rodar de verdade. **Depois de importar, revise as telas
Cadastros e Explosão**: a planilha original tem algumas inconsistências de
nomenclatura entre colunas (nomes livres, sem código) que o importador resolve
por aproximação de nome — o relatório salvo em `server/import-report.txt`
lista os casos resolvidos por aproximação (não por código exato) e as
matérias-primas cujo total recalculado não bateu exatamente com o valor já
salvo na planilha, para você conferir.

## 3. Rodar o sistema

```bash
DATABASE_URL="sua connection string do Postgres" npm start
```

Acesse **http://localhost:3000** no próprio computador, ou pelo IP local desta
máquina a partir de outro computador da rede (o terminal mostra o endereço).

## 4. Usuários de demonstração

| Login | Senha | Papel |
|---|---|---|
| admin | admin123 | Administrador |
| estoque | estoque123 | Estoque |
| contagem | contagem123 | Contagem (só a tela de contagem pelo celular) |

**Troque essas senhas antes de usar com dados reais** (aba Usuários).

## 5. Rodar em várias máquinas / celulares, com o mesmo banco de dados

Um computador roda `npm start` e fica ligado; celulares e outros
computadores acessam pelo navegador usando o **IP local** daquele computador
(`http://192.168.X.X:3000`, mostrado no terminal ao iniciar). Configure esse
computador com IP fixo na rede (reserva por MAC no roteador), senão o
endereço muda e os outros aparelhos perdem o acesso.

## 6. Rodar de graça na Vercel + Supabase

Este projeto já vem preparado para essa combinação: banco Postgres no
**Supabase** (plano free) e hospedagem na **Vercel** (plano Hobby, free). O
backend roda como função serverless (`api/index.js`) e o frontend
(`web/dist`) é servido como site estático.

1. **Criar o projeto no Supabase**: supabase.com → New Project.
2. **Pegar a connection string**: Project Settings → Database → Connection
   string → aba **Transaction** (pooler, porta 6543). É o que vai virar
   `DATABASE_URL` — importante usar o pooler, porque o serverless abre/fecha
   uma conexão por requisição e esgotaria o limite do Postgres direto.
3. Rodar `npm run setup` e `npm run import-xlsx` localmente (seção 1-2) com
   esse `DATABASE_URL`, para criar as tabelas e importar os dados.
4. **Importar o projeto na Vercel** (vercel.com → Add New → Project,
   conectando um repositório Git) ou pela CLI:
   ```bash
   npm i -g vercel
   vercel login
   vercel link
   ```
5. **Configurar as variáveis de ambiente no projeto Vercel** (Project
   Settings → Environment Variables, ou `vercel env add`):
   - `DATABASE_URL` — a mesma connection string do passo 2.
   - `JWT_SECRET` — valor longo e aleatório: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
6. **Deploy**: `vercel --prod`.

Veja `.env.example` para a lista completa de variáveis.

## 7. Segurança — leia antes de usar com dados reais

- **JWT_SECRET**: obrigatório em produção (`NODE_ENV=production`) — o
  servidor recusa iniciar sem isso, de propósito.
- Troque todas as senhas de demonstração antes de usar com dados reais
  (mínimo 8 caracteres).
- Login protegido contra tentativas repetidas (bloqueio após 10 tentativas
  erradas em 15 minutos, por IP).
- Se expor na internet, use sempre HTTPS (a Vercel já faz isso automaticamente).
- Backup: o painel do Supabase mantém backups automáticos diários no plano free.

## 8. Estrutura do projeto

```
server/                    → backend (API, autenticação, banco de dados, cálculo)
  routes/                  → uma rota por recurso
  db.js                    → conexão e schema do banco Postgres (pg)
  calc.js                  → cálculo puro (explosão de matéria-prima, divergência)
  app.js                   → monta o Express (rotas /api/...), sem listen/estático
  index.js                 → uso local/LAN: app.js + estático + app.listen
  import-from-xlsx.js      → lê a planilha original e valida contra os totais dela
  import-from-xlsx-write.js → grava os dados lidos no banco
  import-parsers.js        → parsers de upload do Saldo do Sistema (XLS/PDF)
web/                       → frontend (React)
  src/App.jsx              → todas as telas do sistema
  src/api.js                → chamadas para o backend
api/index.js               → entrypoint serverless usado pela Vercel
vercel.json                → configuração de build/rotas da Vercel
```

## 9. Limitações conhecidas / próximos passos possíveis

- O parser de PDF do "Saldo do Sistema" é **melhor esforço** — ainda não temos
  um exemplo real do arquivo que o fornecedor vai mandar. Ele sempre mostra
  uma prévia (itens casados + pendências) antes de gravar qualquer coisa, e
  itens não reconhecidos ficam disponíveis para correção manual do código.
  Quando tivermos um PDF real do fornecedor, vale ajustar `server/import-parsers.js`
  para o formato exato.
- A planilha original tem algumas inconsistências internas (colunas sem
  código, uma mistura com percentual encadeado em vez de direto sobre o
  total) — ver `server/import-report.txt` gerado pela importação, e os
  comentários em `server/calc.js` e `server/import-from-xlsx.js`.
- Abrir acesso ao fornecedor de fora da empresa: hoje os três papéis
  (Administrador/Estoque/Contagem) já suportam isso — basta criar um usuário
  com papel "Contagem" para o fornecedor usar só a tela de contagem pelo
  celular.
