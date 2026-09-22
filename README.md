# App Questões — Concurso de Auxiliar de Saúde Bucal

[![Deploy no Fly.io](https://github.com/swmschmidt/app-questoes-concurso/actions/workflows/deploy.yml/badge.svg)](https://github.com/swmschmidt/app-questoes-concurso/actions/workflows/deploy.yml)

Aplicativo web para praticar questões de concursos públicos de **Auxiliar de Saúde Bucal**:
questões reais de provas, correção imediata, sem repetição, avaliação de dificuldade,
anotações pessoais, painel de análise do banco e estatísticas por usuário.

**No ar:** https://app-questoes-concurso.fly.dev
**Repositório:** https://github.com/swmschmidt/app-questoes-concurso

---

## Índice

- [Funcionalidades](#funcionalidades)
- [Arquitetura](#arquitetura)
- [Como rodar localmente](#como-rodar-localmente)
- [Variáveis de ambiente e segredos](#variáveis-de-ambiente-e-segredos)
- [Banco de dados](#banco-de-dados)
- [Atualizando o banco de questões](#atualizando-o-banco-de-questões)
- [Autenticação e sessão](#autenticação-e-sessão)
- [API](#api)
- [Deploy](#deploy)
- [Testes](#testes)
- [Estrutura de arquivos](#estrutura-de-arquivos)

---

## Funcionalidades

### Praticar (`/`)

- Banco completo carregado no navegador de uma vez (~13 MB, ~2,9 MB gzip, cacheado pelo browser).
- **Correção imediata**: verde para acerto, vermelho para erro, com o gabarito destacado.
- **Sem repetição**: as questões são sorteadas e o que já foi respondido não volta.
- Filtros facetados de **banca**, **disciplina**, **prova** (órgão · ano) e **dificuldade** —
  cada lista mostra apenas o que existe na combinação atual.
- **Pular** e **voltar** questões, contador de posição, atalhos de teclado (`A`–`E`, `1`–`5`, `←`, `→`, `Enter`).
- **Dificuldade 1–5** (global, sem vínculo com a conta): escala verde→vermelho, com prévia no hover e
  swipe no celular; pode ser removida.
- **Anotação por questão** (da conta) e **relato de erro** (opcional, aberto a qualquer visitante).
- Tema claro/escuro, layout responsivo.

### Suas estatísticas (`/minhas-estatisticas`)

- Requer login. Mostra questões respondidas, acertos, erros, aproveitamento, tentativas e anotações.
- **Temas que você mais acerta** e **temas que você mais erra** (tópicos com ≥ 3 respostas).
- Aproveitamento por disciplina, lista das questões respondidas com o seu resultado
  (filtros por acerto/erro, disciplina, tópico e busca) e suas anotações.
- Progresso sincronizado: ao entrar, o progresso local do navegador é importado para a conta.

### Painel de análise (`/dashboard`)

- **Visão Geral**: KPIs do banco (15.970 questões, 431 provas, 140 bancas, 2010–2026) e gráficos de
  disciplina, ano, bancas, formato, comando e tier.
- **Alta Incidência**: score ponderado por recência (2024–26 = 1,5 · 2021–23 = 1,0 · ≤2020 = 0,6),
  tiers A/B/C e ranking completo dos 22 tópicos.
- **Tópicos**: KPIs, termos frequentes, subtópicos e **todas as questões de um subtópico**
  (“carregar mais” pagina de 20 em 20), com overlay da questão — que funciona como na tela de
  prática: você escolhe a alternativa, recebe o feedback, avalia a dificuldade e anota.
- **Questões**: busca sem acento no enunciado, filtros combináveis, paginação, export CSV e cópia de IDs.

### Conta (`/entrar`)

- Login e criação de conta com **e-mail/senha** e com **Google** (Firebase Authentication),
  além de redefinição de senha por e-mail.
- Mesmo tema claro/escuro do resto do app e o mesmo visual de botões/cartões.

---

## Arquitetura

```
Navegador
  ├── /            SPA de prática (app.js) — progresso local e/ou da conta
  ├── /dashboard   painel de análise (dashboard.js)
  ├── /minhas-estatisticas  estatísticas da conta (minhas.js)
  └── /entrar      login e cadastro (entrar.js)
        │  fetch JSON + Bearer <JWT de acesso>
        ▼
Flask (1 worker gunicorn, 256 MB, scale-to-zero no Fly.io)
  ├── questões: questoes.json → payload enxuto pré-comprimido no build da imagem (dados/*.gz)
  ├── dados persistentes: Postgres (Supabase)
  └── autenticação: Firebase Authentication (API REST do Identity Toolkit) + sessão própria
        │
        ├── Supabase (Postgres)  questoes, questoes_classificacao, topicos, subtopicos,
        │                        avaliacoes (global), anotacoes, respostas, usuarios, sessoes, reportes
        └── Firebase Auth        credenciais (e-mail/senha) e envio de e-mail de redefinição
```

Decisões que valem registrar:

- **O JSON não é lido em tempo de execução.** `scripts/gerar_payload.py` roda no build da imagem e gera
  `dados/questoes.payload.json.gz` (payload servido em `/api/questoes`) e `dados/questoes.ids.txt.gz`
  (ids válidos). Isso mantém o start em menos de 1 segundo e o processo em ~60 MB de RAM —
  sem isso, parsear 21 MB de JSON estourava os 256 MB da máquina.
- **A dificuldade é global; a anotação é da conta.** É o que foi pedido: as notas ajudam a ranquear as
  questões para todo mundo, enquanto anotações são lembretes pessoais.
- **A sessão é nossa** (JWT curto + refresh rotativo em cookie `httpOnly`), mas a **senha é do Firebase**:
  o app nunca vê nem guarda senha.
- **O painel é público**; as estatísticas pessoais exigem login.

---

## Como rodar localmente

Pré-requisitos: Python 3.12+, uma conexão Postgres (Supabase) e, opcionalmente, credenciais Firebase
para testar login. Sem `DATABASE_URL` o app sobe em modo degradado (questões funcionam; avaliações,
anotações e estatísticas ficam indisponíveis).

```bash
python -m venv .venv
.venv\Scripts\activate            # Windows
# source .venv/bin/activate       # Linux/macOS

pip install -r requirements.txt

# gera os artefatos do banco (também roda automaticamente no build da imagem)
python scripts/gerar_payload.py

# variáveis de ambiente (exemplo)
set DATABASE_URL=postgresql://usuario:senha@host:5432/postgres
set JWT_SECRET=um-segredo-bem-grande
set FIREBASE_API_KEY=...          # chave pública do app web do Firebase
set FIREBASE_PROJECT_ID=...

python app.py                     # http://127.0.0.1:8080
```

Para criar as tabelas e carregar os dados:

```bash
python scripts/importar_questoes.py --dsn "$DATABASE_URL"
python scripts/importar_dashboard.py --dsn "$DATABASE_URL" \
  --categorizadas "caminho/para/questoes_categorizadas.json" \
  --estatisticas  "caminho/para/estatisticas.json"
```

---

## Variáveis de ambiente e segredos

| Variável | Obrigatória | Para que serve |
|---|---|---|
| `DATABASE_URL` | sim (para dados persistentes) | conexão Postgres do Supabase (use o pooler `aws-0-sa-east-1.pooler.supabase.com:6543`, porque o host direto é IPv6) |
| `JWT_SECRET` | sim | assinatura dos tokens de acesso (HS256) |
| `FIREBASE_API_KEY` | sim (para login) | chave pública do app web do Firebase, usada na API REST do Identity Toolkit |
| `FIREBASE_PROJECT_ID` | sim (para login) | id do projeto Firebase |
| `FIREBASE_APP_ID` | não | id do app web do Firebase (usado pelo SDK no login com Google) |
| `PERMITIR_GERAR_PAYLOAD` | não | `0` no container: falha com erro claro se os artefatos faltarem, em vez de tentar parsear o JSON |
| `PORT` | não | porta do servidor (padrão 8080) |

No Fly.io os valores ficam em segredos:

```bash
fly secrets set DATABASE_URL="postgresql://..." JWT_SECRET="..." \
  FIREBASE_API_KEY="..." FIREBASE_PROJECT_ID="..."
```

> **Nunca versione credenciais.** O JSON da conta de serviço do Firebase
> (`*firebase-adminsdk*.json`) está no `.gitignore` e no `.dockerignore`. Ele só é usado pelo script de
> administração `scripts/configurar_firebase.py` (rodado da sua máquina), não pela aplicação.

---

## Banco de dados

Tabelas (todas em `scripts/schema.sql`, idempotente — pode rodar quantas vezes quiser):

| Tabela | Conteúdo |
|---|---|
| `questoes` | espelho do `questoes.json` (15.970 linhas) + `enunciado_busca` (sem acento, para busca) |
| `questoes_classificacao` | disciplina de análise, tópico, subtópico, formato, comando, score/tier — FK para `questoes(id)` |
| `topicos` / `subtopicos` | incidência pré-calculada (score, tier, por ano, top bancas, termos) |
| `avaliacoes` | dificuldade 1–5 por questão (**global**) |
| `anotacoes` | anotações por usuário e questão |
| `respostas` | histórico de respostas por usuário (append-only) |
| `usuarios` | contas (e-mail, nome, `firebase_uid`) |
| `sessoes` | refresh tokens (hash, expiração, revogação) |
| `reportes` | relatos de erro (texto opcional) |

Todas com RLS habilitado e sem permissões para os papéis `anon`/`authenticated` do Supabase —
o acesso é feito pelo backend com a conexão direta.

---

## Atualizando o banco de questões

1. Substitua `questoes.json` pelo banco novo (mesmo formato: `id`, `prova_slug`, `banca`, `orgao`,
   `ano`, `cargo`, `disciplina`, `numero`, `enunciado`, `alternativas`, `gabarito`, `status`).
2. `python scripts/gerar_payload.py` (regera os artefatos; o Docker também regenera no build).
3. `python scripts/importar_questoes.py --dsn "$DATABASE_URL"` (upsert + remove o que saiu do JSON).
4. Se você tem uma análise nova (tópicos/subtópicos/classificação):
   `python scripts/importar_dashboard.py --dsn "$DATABASE_URL" --categorizadas ... --estatisticas ...`.
5. `fly deploy` (ou apenas faça commit — o GitHub Actions faz o deploy).

---

## Autenticação e sessão

- **Cadastro/login**: o backend chama a API REST do Firebase (`accounts:signUp` /
  `accounts:signInWithPassword`) com a `FIREBASE_API_KEY`. A senha vai direto para o Google;
  o app nunca a armazena.
- **Login com Google**: o navegador usa o SDK do Firebase (`signInWithPopup`, com
  `signInWithRedirect` de reserva) e envia o ID token do Google para `POST /api/auth/google`;
  o backend valida esse token via `accounts:signInWithIdp` e cria a sessão do app.
- **Token de acesso**: JWT HS256 (`sub`, `email`, `nome`, `tipo=acesso`), validade de **30 minutos**,
  guardado apenas em memória no navegador (não vai para `localStorage`).
- **Refresh token**: string aleatória de 256 bits, guardada como hash SHA-256 em `sessoes`, enviada em
  cookie `httpOnly` (`Secure` em HTTPS, `SameSite=Lax`, `path=/api/auth`), validade de **30 dias**.
- **Rotação**: cada `/api/auth/refresh` revoga o token usado e emite um novo; reutilizar um token
  revogado responde `401`.
- **Logout**: revoga a sessão no banco e limpa o cookie.
- **Redefinição de senha**: `/api/auth/senha` dispara o e-mail do Firebase
  (`accounts:sendOobCode`), sem revelar se o e-mail existe.

---

## API

Públicas:

| Rota | Descrição |
|---|---|
| `GET /api/questoes` | payload do banco de questões (gzip, `ETag`, cache de 1 dia) |
| `GET /api/avaliacoes` | mapa `questao_id → nota` (dificuldade global) |
| `POST /api/avaliacoes` · `DELETE /api/avaliacoes/<id>` | salva/remove dificuldade |
| `POST /api/reportes` | registra relato de erro (descrição opcional) |
| `GET /api/dashboard/*` | `resumo`, `topicos`, `estatisticas`, `questoes`, `questao/<id>`, `ids`, `export.csv` |
| `GET /healthz` | health check |

De conta (`Authorization: Bearer <token>`):

| Rota | Descrição |
|---|---|
| `POST /api/auth/registrar` · `/login` · `/google` · `/refresh` · `/logout` · `/senha` · `GET /api/auth/eu` | sessão |
| `GET/POST/DELETE /api/anotacoes[/<id>]` | anotações do usuário |
| `GET/POST/DELETE /api/minhas/respostas` | histórico de respostas (e `POST /lote` para importar o progresso local) |
| `GET /api/minhas/resumo` · `/questoes` · `/anotacoes` | estatísticas pessoais |

---

## Deploy

**Automático (GitHub Actions)** — `.github/workflows/deploy.yml` roda em todo push para `main`:
instala o `flyctl`, faz `fly deploy --ha=false` e valida `/healthz` no ar.
O workflow usa o segredo `FLY_API_TOKEN` do repositório.

```bash
gh secret set FLY_API_TOKEN --repo <owner>/<repo>   # token de deploy do Fly
```

**Manual:**

```bash
fly deploy --ha=false          # --ha=false garante 1 máquina
fly logs --app app-questoes-concurso
```

Configuração da máquina (`fly.toml`): 1 máquina `shared-cpu-1x` com **256 MB** em `gru`,
`auto_stop_machines = "stop"` e `min_machines_running = 0` — ou seja, **escala para zero** quando
ninguém está usando (o primeiro acesso depois disso leva ~2 s).

---

## Testes

Os testes de ponta a ponta rodam a aplicação real em um DOM (jsdom) contra um servidor local,
com o Postgres de verdade:

- `teste_conta.js` — cadastro, login, sessão, importação do progresso local, estatísticas, logout,
  isolamento entre contas e comportamento de visitante.
- `teste_pratica.js` — filtros facetados, correção imediata, sem repetição, pular/voltar, resumo.
- `teste_dashboard.js` — painel, tópicos, subtópicos, overlay, filtros, export.
- `teste_overlay.js` — overlay respondível com dificuldade, anotação e relato.
- `teste_app_novo_banco.js` — carga do banco e contratos da API.

Sintaxe: `node --check static/js/*.js` e `python -m compileall app.py scripts`.

---

## Estrutura de arquivos

```
app.py                        Flask: rotas, sessão, regras de negócio e SQL
questoes_bank.py              leitura do questoes.json e artefatos pré-gerados
questoes.json                 banco bruto de questões (fonte)
dados/                        artefatos gerados (payload comprimido + ids) — fora do git
templates/
  index.html                  SPA de prática
  dashboard.html              painel de análise
  minhas_estatisticas.html    estatísticas da conta
  entrar.html                 login e cadastro
static/
  css/app.css                 tema e componentes base (compartilhados)
  css/dashboard.css           componentes do painel e das estatísticas
  js/auth.js                  sessão no navegador (JWT em memória + refresh)
  js/app.js                   prática
  js/dashboard.js             painel
  js/minhas.js                estatísticas
  js/entrar.js                login/cadastro (e-mail/senha e Google)
  js/tema.js                  tema claro/escuro compartilhado (roda antes da renderização)
scripts/
  schema.sql                  DDL completo (idempotente)
  gerar_payload.py            gera dados/*.gz a partir do questoes.json
  importar_questoes.py        sincroniza questões com o Postgres
  importar_dashboard.py       sincroniza tópicos/subtópicos/classificação
  configurar_firebase.py      administração do Firebase (conta de serviço)
Dockerfile · fly.toml · requirements.txt
.github/workflows/deploy.yml  deploy automático no Fly.io
```

---

## Avisos

- As notas de dificuldade são **globais** (ajudam a ranquear as questões para todos os usuários).
- Anotações e respostas são **por conta** e ficam no Postgres; os relatos de erro são públicos.
- O banco de questões vem de provas públicas e passa por extração automática — erros podem existir;
  use o botão “Reportar erro” na questão.
