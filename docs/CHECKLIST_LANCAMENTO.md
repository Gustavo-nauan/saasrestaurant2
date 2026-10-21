# Checklist de Lançamento — Pedido na Mão

Use esta lista antes de liberar o sistema para clientes reais no salão. Marque cada item (`[x]`) somente após testar e confirmar em produção.

---

## 1. Banco de dados e Supabase

- [ ] Projeto criado no Supabase na região mais próxima dos clientes (ex.: South America - São Paulo).
- [ ] `js/supabase.js` atualizado com a `SUPABASE_URL` e a `SUPABASE_ANON_KEY` (chave pública `anon`/`publishable`) do projeto de produção.
- [ ] Scripts SQL executados sem erros na ordem oficial:
  - [ ] `SQL/01_schema.sql`
  - [ ] `SQL/02_rls.sql`
  - [ ] `SQL/03_funcoes.sql`
  - [ ] `SQL/07_admin_catalogo.sql`
  - [ ] `SQL/08_admin_relatorio.sql`
- [ ] Caso o `SQL/04_seed.sql` tenha sido executado durante testes, os produtos/categorias de exemplo foram removidos ou substituídos pelo cardápio real do restaurante.
- [ ] Dados reais do restaurante (`nome`, `slug`, `telefone`, `endereco`, `ativo = true`) cadastrados na tabela `public.restaurantes`.
- [ ] Índices conferidos com `SQL/06_auditoria_indices.sql`.

---

## 2. Autenticação e contas

- [ ] Em **Authentication -> URL Configuration**, o campo **Site URL** aponta para o domínio oficial de produção (`https://...`).
- [ ] As **Redirect URLs** incluem o domínio de produção (`https://seu-dominio/**`).
- [ ] Configuração de confirmação de e-mail (**Confirm email**) revisada conforme a operação do salão (desativada caso o cliente precise fazer login e pedir imediatamente na mesa sem abrir a caixa de e-mail).
- [ ] Conta do administrador criada no Supabase Auth com senha forte e vinculada em `public.funcionarios` com `papel = 'admin'` e `ativo = true`.
- [ ] Conta da cozinha criada no Supabase Auth e vinculada em `public.funcionarios` com `papel = 'cozinha'` e `ativo = true`.
- [ ] Contas de teste antigas desativadas ou removidas de `public.funcionarios` e `auth.users`.

---

## 3. Storage (Fotos do cardápio)

- [ ] Bucket `produtos` criado no Supabase Storage e marcado como **Public**.
- [ ] Limite de tamanho do bucket confirmado em `2097152` bytes (2 MB) e tipos permitidos restritos a `image/jpeg`, `image/png` e `image/webp`.
- [ ] Políticas RLS de `storage.objects` ativas (leitura pública somente no bucket `produtos`; upload, atualização e exclusão restritos ao administrador do restaurante dono da pasta).

---

## 4. Realtime

- [ ] Tabela `public.pedidos` adicionada à publicação `supabase_realtime` em **Database -> Replication**.
- [ ] Indicador de conexão no topo do painel da cozinha (`/cozinha/painel.html`) exibe o estado conectado ("Tempo real ativo") ao abrir a página.

---

## 5. Segurança

- [ ] Script `SQL/09_auditoria_seguranca.sql` executado no SQL Editor do Supabase com todos os resultados conferidos:
  - [ ] **Item 1**: `0` tabelas sem RLS no schema `public`.
  - [ ] **Item 2**: políticas RLS presentes e corretas em todas as 7 tabelas.
  - [ ] **Item 3**: nenhum privilégio indevido que permita escrita anônima.
  - [ ] **Item 4**: todas as funções `SECURITY DEFINER` possuem `search_path_fixado = true` e `anon_pode_executar = false` em `criar_pedido`, `cancelar_pedido` e `admin_relatorio`.
  - [ ] **Item 5**: bucket `produtos` e políticas de `storage.objects` conferidos.
  - [ ] **Item 6**: blocos de teste simulados (`BEGIN ... ROLLBACK`) validados garantindo que um cliente não vê pedidos de outro cliente e que a cozinha não altera preços nem acessa `admin_relatorio`.
  - [ ] **Item 7**: lista de `public.funcionarios` contém exclusivamente pessoas autorizadas.
- [ ] Confirmado que nenhuma chave `service_role` ou `sb_secret_` está presente no código-fonte ou no histórico do repositório.
- [ ] Pasta `dev/` (`dev/componentes.html`) removida ou bloqueada antes da publicação final em produção.
- [ ] Cabeçalhos HTTP de segurança de `vercel.json` verificados no navegador (aba Rede / Network do DevTools) após o deploy.

---

## 6. Testes ponta a ponta

### 6.1. Fluxo do Cliente (testar em um celular real)
- [ ] Abrir o link do QR Code de uma mesa (`/cliente/cardapio.html?r=SLUG&mesa=01`).
- [ ] Verificar carregamento das categorias, busca por texto e abertura do modal de detalhes de um produto.
- [ ] Adicionar 2 produtos ao carrinho (um deles com observação do item) e avançar para `/cliente/carrinho.html`.
- [ ] Confirmar que o número da mesa veio preenchido automaticamente.
- [ ] Clicar em enviar pedido, criar uma nova conta de cliente na tela `/cliente/login.html` e verificar o retorno automático ao carrinho.
- [ ] Confirmar o envio do pedido e verificar o redirecionamento para `/cliente/pedido.html?id=...` com a senha de 4 dígitos exibida.
- [ ] Testar o histórico em `/cliente/historico.html` e o botão "Pedir novamente".

### 6.2. Fluxo da Cozinha (testar em tablet ou computador)
- [ ] Entrar em `/cliente/login.html` com a conta da cozinha e verificar o redirecionamento automático para `/cozinha/painel.html`.
- [ ] Fazer um novo pedido pelo celular e verificar se ele surge instantaneamente na coluna **Novos** com alerta sonoro.
- [ ] Avançar o pedido para **Em preparo**, depois para **Prontos** e finalmente para **Entregue**, verificando que o celular do cliente reflete cada mudança em tempo real.
- [ ] Testar a alternância de tema (Claro / Suave) e o botão de tela cheia.

### 6.3. Fluxo do Administrador (testar no computador)
- [ ] Entrar em `/cliente/login.html` com a conta de administrador e verificar o redirecionamento automático para `/admin/produtos.html`.
- [ ] Criar uma nova categoria em `/admin/categorias.html` e testar a reordenação (subir/descer).
- [ ] Criar um novo produto em `/admin/produtos.html`, enviar uma foto real, salvar e verificar se a miniatura e o cardápio do cliente exibem a foto.
- [ ] Abrir `/admin/pedidos.html`, filtrar por período, conferir os cartões de KPI, os gráficos, o modal de detalhes do pedido e a exportação de CSV.

---

## 7. QR Codes das mesas

- [ ] URLs geradas com o domínio definitivo e o `slug` correto do restaurante (`https://SEU-DOMINIO/cliente/cardapio.html?r=SLUG&mesa=NUMERO`).
- [ ] Todos os QR Codes impressos foram testados individualmente com a câmera de pelo menos dois celulares diferentes (Android e iOS).

---

## 8. Publicação na Vercel e domínio

- [ ] Repositório conectado à Vercel com deploy automático a partir da branch `main`.
- [ ] Domínio personalizado (se houver) configurado com HTTPS ativo.
- [ ] Página `404.html` testada acessando uma URL inexistente no domínio publicado.
