# Pedido na Mão

Sistema web de autoatendimento para restaurantes com cardápio digital por QR Code, acompanhamento de pedido em tempo real, painel de cozinha (KDS) e painel administrativo com relatórios.

Construído com **HTML5**, **CSS3** e **JavaScript puro (ES Modules)** no navegador e **Supabase** (PostgreSQL, Row Level Security, Auth, Realtime e Storage) no back-end.

---

## 1. Visão geral e as 3 experiências

O **Pedido na Mão** atende três perfis em uma única aplicação:

1. **Cliente (`/cliente/*`)**:
   - Escaneia o QR Code da mesa (ou acessa o link do restaurante), navega pelo cardápio por categorias com busca instantânea, monta o carrinho com observações por item, faz login ou cria conta rapidamente, envia o pedido e acompanha em tempo real cada etapa (`Recebido` -> `Em preparo` -> `Pronto` -> `Entregue`) com senha de chamada em destaque e histórico de pedidos anteriores.
2. **Cozinha (`/cozinha/painel.html`)**:
   - Painel operacional (KDS) com atualização em tempo real e alerta sonoro sintético (Web Audio API) a cada novo pedido, colunas por status (`Novos`, `Em preparo`, `Prontos`), cronômetro colorido por tempo de espera (normal, atenção e urgente), modo tela cheia e alternância de tema claro/suave.
3. **Administração (`/admin/*`)**:
   - Gestão completa do cardápio: categorias com reordenação e ativação/desativação, produtos com redimensionamento automático de fotos (WebP até 800 px) e envio para o Supabase Storage, além da página de pedidos e relatórios financeiros por período com indicadores (KPIs), gráfico diário em SVG, ranking dos produtos mais vendidos e exportação CSV.

O acesso de clientes, cozinha e administração é feito por uma **única tela de login** (`/cliente/login.html`), que identifica automaticamente o perfil da conta após a autenticação e redireciona o usuário para a área correspondente.

---

## 2. Estrutura de pastas e arquivos

```text
.
├── index.html                      # Tela inicial de apresentação com mural animado e acesso ao cardápio/login
├── 404.html                        # Página personalizada para endereços não encontrados (Erro 404)
├── vercel.json                     # Configuração de cabeçalhos de segurança HTTP, cache e indexação na Vercel
├── REGRAS.md                       # Diretrizes de arquitetura, design system, segurança e padrões do projeto
├── README.md                       # Documentação completa de configuração, operação e publicação
├── assets/
│   └── img/
│       ├── logo.png                # Logo oficial colorida da marca Pedido na Mão
│       ├── logo-branca.png         # Variação clara da logo da marca
│       └── mural/                  # Fotos otimizadas dos pratos exibidas no mural animado da tela inicial
├── cliente/
│   ├── login.html                  # Tela unificada de entrada e cadastro (clientes, cozinha e administração)
│   ├── login.js                    # Lógica de autenticação, cadastro de cliente e redirecionamento por papel
│   ├── cardapio.html               # Cardápio digital do restaurante com categorias, busca e modal do produto
│   ├── cardapio.js                 # Carregamento do catálogo público, filtro em memória e barra do carrinho
│   ├── carrinho.html               # Revisão de itens, mesa, observações do pedido e confirmação de envio
│   ├── carrinho.js                 # Edição de quantidades, resumo de valores e chamada à RPC criar_pedido
│   ├── pedido.html                 # Acompanhamento ao vivo do status e senha de chamada do pedido
│   ├── pedido.js                   # Assinatura Realtime do pedido, linha do tempo e cancelamento seguro
│   ├── historico.html              # Lista de pedidos anteriores do cliente autenticado
│   └── historico.js                # Consulta paginada do histórico e função "Pedir novamente"
├── cozinha/
│   ├── painel.html                 # Painel da cozinha (KDS) com três colunas de preparo
│   └── painel.js                   # Realtime de pedidos ativos, cronômetros, alerta sonoro e avanço de status
├── equipe/
│   └── login.html                  # Redirecionamento automático para o login unificado (/cliente/login.html)
├── admin/
│   ├── produtos.html               # Gestão de produtos do cardápio e upload de imagens
│   ├── produtos.js                 # CRUD de produtos, compressão WebP em canvas e upload no Storage
│   ├── categorias.html             # Gestão e ordenação das categorias do cardápio
│   ├── categorias.js               # CRUD de categorias e reordenação de exibição
│   ├── pedidos.html                # Histórico administrativo de pedidos e relatório gerencial
│   └── pedidos.js                  # KPIs, gráfico SVG de faturamento, top produtos, listagem e exportação CSV
├── css/
│   ├── tokens.css                  # Variáveis CSS do design system (cores, fontes, espaçamentos, sombras)
│   ├── base.css                    # Reset moderno, tipografia base, foco acessível e regras globais
│   ├── componentes.css             # Componentes reutilizáveis (botões, campos, badges, modais, toasts, marca)
│   ├── inicio.css                  # Estilos da tela inicial e do mural diagonal animado
│   ├── cliente-login.css           # Estilos da página unificada de login e cadastro
│   ├── cardapio.css                # Estilos do cardápio, abas de categorias e grade responsiva de produtos
│   ├── carrinho.css                # Estilos da página do carrinho e confirmação de pedido
│   ├── pedido.css                  # Estilos da página de acompanhamento de pedido e linha do tempo
│   ├── historico.css               # Estilos da lista de pedidos anteriores do cliente
│   ├── cozinha.css                 # Estilos do painel da cozinha (KDS) e cartões de pedido por prioridade
│   ├── admin.css                   # Layout compartilhado da administração (sidebar, topbar, tabelas, modais)
│   └── admin-pedidos.css           # Estilos dos cartões de métricas, gráficos SVG e tabela de pedidos do admin
├── js/
│   ├── supabase.js                 # Inicialização do cliente Supabase com URL e chave pública (anon)
│   ├── auth.js                     # Funções de autenticação, sessão e identificação de perfil (obterContextoUsuario)
│   ├── carrinho.js                 # Estado do carrinho e contexto (restaurante/mesa) no localStorage
│   ├── utils.js                    # Utilitários de moeda (centavos -> R$), datas, debounce, toasts e modais
│   ├── icones.js                   # Biblioteca central de ícones vetoriais SVG inline
│   ├── marca.js                    # Renderização padronizada da logo e wordmark "Pedido na Mão"
│   ├── inicio.js                   # Montagem do mural animado da tela inicial e atalho de pedido em andamento
│   └── admin-comum.js              # Guarda de rota administrativa, cabeçalho/menu lateral e helpers de UI
├── SQL/
│   ├── 01_schema.sql               # Criação de tabelas, tipos ENUM, índices e triggers de atualizado_em
│   ├── 02_rls.sql                  # Funções auxiliares de permissão e políticas Row Level Security (RLS)
│   ├── 03_funcoes.sql              # Funções RPC transacionais criar_pedido e cancelar_pedido
│   ├── 04_seed.sql                 # Dados iniciais de demonstração (restaurante, categorias e produtos)
│   ├── 05_VINCULAR_EQUIPE.sql      # Exemplos comentados para vincular contas à tabela funcionarios
│   ├── 06_auditoria_indices.sql    # Consultas de verificação de índices e desempenho
│   ├── 07_admin_catalogo.sql       # Políticas de administração do catálogo e bucket Storage 'produtos'
│   ├── 08_admin_relatorio.sql      # Função RPC admin_relatorio com métricas diárias e top produtos
│   └── 09_auditoria_seguranca.sql  # Script somente de leitura para auditoria completa de segurança do banco
├── docs/
│   └── CHECKLIST_LANCAMENTO.md     # Checklist passo a passo para validação antes de ir ao ar
└── dev/
    └── componentes.html            # Catálogo visual interno do design system (remover antes de publicar)
```

---

## 3. Passo a passo: configurando o Supabase do zero

### 3.1. Criar o projeto e obter as credenciais públicas
1. Acesse [https://supabase.com/dashboard](https://supabase.com/dashboard) e clique em **New project**.
2. Escolha a organização, defina o nome do projeto, crie uma senha forte para o banco e selecione a região mais próxima (ex.: *South America (São Paulo)*).
3. Aguarde a criação do projeto e acesse **Project Settings -> API** (ou **Data API / API Keys**).
4. Copie dois valores:
   - **Project URL** (ex.: `https://seu-projeto.supabase.co`)
   - **Anon / Publishable Key** (chave pública; **nunca** use a chave `service_role` ou `secret` no front-end).
5. Abra o arquivo `js/supabase.js` e atualize as constantes `SUPABASE_URL` e `SUPABASE_ANON_KEY`.

### 3.2. Executar os scripts SQL na ordem correta
No painel do Supabase, abra **SQL Editor -> New query** e execute o conteúdo de cada arquivo da pasta `SQL/` na ordem abaixo:

1. **`SQL/01_schema.sql`**: cria os tipos (`papel_funcionario`, `status_pedido`), as 7 tabelas (`restaurantes`, `categorias`, `produtos`, `clientes`, `funcionarios`, `pedidos`, `itens_pedido`), restrições e índices.
2. **`SQL/02_rls.sql`**: ativa o Row Level Security (RLS) em todas as tabelas e cria as funções `public.eh_funcionario` e `public.eh_admin` junto com as políticas de acesso.
3. **`SQL/03_funcoes.sql`**: cria as funções RPC seguras `public.criar_pedido` (que recalcula preços no servidor e gera a senha de 4 dígitos) e `public.cancelar_pedido` (que permite ao cliente cancelar apenas enquanto o status for `recebido`).
4. **`SQL/04_seed.sql`** *(opcional para ambiente de testes)*: cadastra o restaurante de demonstração (`cantina-da-praca`), categorias e 12 produtos de exemplo.
5. **`SQL/06_auditoria_indices.sql`** *(opcional)*: verifica índices criados nas chaves estrangeiras e colunas de filtro.
6. **`SQL/07_admin_catalogo.sql`**: configura as políticas de escrita para administradores em `categorias` e `produtos`, cria o bucket público `'produtos'` no Supabase Storage (limite de 2 MB, formatos JPEG/PNG/WebP) e aplica as políticas de upload/exclusão por pasta do restaurante.
7. **`SQL/08_admin_relatorio.sql`**: cria a função RPC `public.admin_relatorio` que agrega faturamento, contagens por status, série diária e top 10 produtos para o painel administrativo.
8. **`SQL/09_auditoria_seguranca.sql`**: script somente de leitura para auditar RLS, privilégios, funções `SECURITY DEFINER`, Storage e isolamento entre contas.

### 3.3. Habilitar o Realtime na tabela `pedidos`
Para que a tela de acompanhamento do cliente e o painel da cozinha recebam atualizações instantâneas sem precisar recarregar a página:

1. No menu lateral do Supabase, acesse **Database -> Replication** (ou **Database -> Publications**).
2. Clique na publicação **`supabase_realtime`**.
3. Ative a chave (toggle) da tabela **`public.pedidos`**.

### 3.4. Confirmar o bucket `'produtos'` no Storage
1. No menu lateral do Supabase, acesse **Storage**.
2. Confirme que o bucket **`produtos`** aparece listado com a etiqueta **Public** (ele é criado automaticamente pelo script `SQL/07_admin_catalogo.sql`).

### 3.5. Configurar URLs permitidas de Autenticação
1. Acesse **Authentication -> URL Configuration**.
2. Em **Site URL**, informe o domínio oficial onde o site ficará hospedado (ex.: `https://seu-restaurante.vercel.app`).
3. Em **Redirect URLs**, adicione:
   - `https://seu-restaurante.vercel.app/**`
   - `http://localhost:3000/**` (para testes locais)
4. Em **Authentication -> Providers -> Email**:
   - Para operação rápida em restaurante (onde o cliente faz o pedido imediatamente na mesa), recomenda-se desativar **Confirm email** (*Enable email confirmations = OFF*), permitindo login imediato após o cadastro.

---

## 4. Como cadastrar o restaurante e vincular o primeiro Admin e Cozinha

### Passo 1: Cadastrar (ou consultar) o restaurante
Se você rodou o `04_seed.sql`, o restaurante `cantina-da-praca` já existe. Para cadastrar um novo restaurante próprio, rode no **SQL Editor**:

```sql
INSERT INTO public.restaurantes (nome, slug, telefone, endereco, ativo)
VALUES (
  'Meu Restaurante',
  'meu-restaurante',
  '(11) 99999-0000',
  'Rua Exemplo, 100 - Centro',
  true
)
RETURNING id, nome, slug;
```

### Passo 2: Criar os usuários de Admin e Cozinha no Supabase Auth
1. No painel do Supabase, acesse **Authentication -> Users -> Add user -> Create new user**.
2. Crie um usuário para o administrador (ex.: `admin@meurestaurante.com.br`) marcando **Auto Confirm User**.
3. Crie um usuário para a cozinha (ex.: `cozinha@meurestaurante.com.br`) marcando **Auto Confirm User**.
   *(Alternativamente, você também pode criar essas contas pela própria tela `/cliente/login.html` na aba "Criar conta").*

### Passo 3: Vincular as contas na tabela `public.funcionarios`
Rode o comando abaixo no **SQL Editor** ajustando o `slug` do restaurante e os e-mails criados:

```sql
-- 1. Vincular Administrador
INSERT INTO public.funcionarios (usuario_id, restaurante_id, nome, papel, ativo)
SELECT
  u.id,
  r.id,
  'Administrador Geral',
  'admin'::public.papel_funcionario,
  true
FROM auth.users u
CROSS JOIN public.restaurantes r
WHERE lower(u.email) = lower('admin@meurestaurante.com.br')
  AND r.slug = 'meu-restaurante'
ON CONFLICT (usuario_id, restaurante_id)
DO UPDATE SET papel = 'admin', ativo = true;

-- 2. Vincular Equipe da Cozinha
INSERT INTO public.funcionarios (usuario_id, restaurante_id, nome, papel, ativo)
SELECT
  u.id,
  r.id,
  'Equipe Cozinha',
  'cozinha'::public.papel_funcionario,
  true
FROM auth.users u
CROSS JOIN public.restaurantes r
WHERE lower(u.email) = lower('cozinha@meurestaurante.com.br')
  AND r.slug = 'meu-restaurante'
ON CONFLICT (usuario_id, restaurante_id)
DO UPDATE SET papel = 'cozinha', ativo = true;
```

> **Importante**: caso você tenha criado essas contas usando a aba "Criar conta" da tela `/cliente/login.html`, um registro também terá sido criado na tabela `public.clientes`. Isso não impede o funcionamento, pois `obterContextoUsuario` prioriza `public.funcionarios`, mas você pode remover o vínculo de cliente se desejar com:
> ```sql
> DELETE FROM public.clientes
> WHERE usuario_id IN (
>   SELECT usuario_id FROM public.funcionarios WHERE ativo = true
> );
> ```

---

## 5. Como gerar os QR Codes das mesas

Cada mesa do restaurante pode ter seu próprio QR Code apontando direto para o cardápio com o restaurante e o número da mesa preenchidos automaticamente.

Formato da URL:

```text
https://SEU-DOMINIO/cliente/cardapio.html?r=SLUG-DO-RESTAURANTE&mesa=NUMERO
```

Exemplos práticos:
- **Mesa 01**: `https://seu-dominio.vercel.app/cliente/cardapio.html?r=cantina-da-praca&mesa=01`
- **Mesa 12**: `https://seu-dominio.vercel.app/cliente/cardapio.html?r=cantina-da-praca&mesa=12`
- **Balcão / Viagem (sem mesa fixa)**: `https://seu-dominio.vercel.app/cliente/cardapio.html?r=cantina-da-praca`

Quando o cliente abre esse link:
1. O sistema salva o `slug` do restaurante e o número da `mesa` no navegador.
2. Na tela de finalizar pedido (`/cliente/carrinho.html`), o campo **Mesa** já vem preenchido automaticamente.

---

## 6. Como rodar o projeto localmente

Por usar **ES Modules** (`<script type="module">`), os arquivos precisam ser servidos por um servidor HTTP local (não abra com duplo clique via `file://`).

Escolha qualquer uma das opções abaixo na pasta raiz do projeto:

### Opção A — Com Node.js (`npx serve`)
```bash
npx serve . -l 3000
```
Depois acesse: `http://localhost:3000`

### Opção B — Com Python 3
```bash
python -m http.server 3000
```
Depois acesse: `http://localhost:3000`

---

## 7. Como publicar na Vercel

O projeto já inclui o arquivo `vercel.json` configurado com cabeçalhos de segurança (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, `Content-Security-Policy-Report-Only`), bloqueio de indexação em áreas internas (`X-Robots-Tag: noindex, nofollow`) e cache otimizado para imagens.

1. Suba o repositório para a sua conta no **GitHub**.
2. Acesse [https://vercel.com/new](https://vercel.com/new) e importe o repositório.
3. Mantenha **Framework Preset** como **Other** (não há etapa de build necessária) e **Output Directory** como `.` (padrão).
4. Clique em **Deploy**.
5. A cada novo `git push origin main`, a Vercel publicará automaticamente a nova versão.

---

## 8. Solução de problemas comuns (Troubleshooting)

### 1. A logo não aparece em alguma página
- Verifique se os arquivos `assets/img/logo.png` e `assets/img/logo-branca.png` estão versionados no Git (`git ls-files assets/img/`).
- Confirme que a página inclui `<script type="module" src=".../js/marca.js"></script>` e o elemento `<span class="marca" data-marca="padrao"></span>`.

### 2. O status do pedido ou o painel da cozinha não atualiza sozinho (Realtime)
- Verifique no painel do Supabase em **Database -> Replication -> `supabase_realtime`** se a tabela `public.pedidos` está marcada como ativa.
- Mesmo que a conexão WebSocket oscile na rede do restaurante, tanto o acompanhamento do cliente quanto o painel da cozinha possuem atualização periódica automática de segurança (fallback a cada 10–15 segundos).

### 3. Erro "Acesso negado" ao entrar em `/admin/*` ou `/cozinha/painel.html`
- A conta autenticada precisa estar cadastrada na tabela `public.funcionarios` com `ativo = true` e o `papel` correspondente (`admin` para administração; `cozinha` ou `admin` para o painel da cozinha).
- Execute a consulta da **Seção 7** de `SQL/09_auditoria_seguranca.sql` no SQL Editor para conferir os vínculos atuais.

### 4. Erro ao enviar foto de produto no painel Admin
- Confirme que o script `SQL/07_admin_catalogo.sql` foi executado integralmente no SQL Editor.
- Verifique se o usuário logado possui `papel = 'admin'` e `ativo = true` para o restaurante do produto.
- A imagem deve estar nos formatos JPEG, PNG ou WebP e respeitar o limite de 2 MB após o processamento.
