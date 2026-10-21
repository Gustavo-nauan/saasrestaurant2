-- ============================================================================
-- 09_auditoria_seguranca.sql — Pedido na Mão
-- Fase 6.1: Auditoria de segurança somente de leitura do banco de dados
-- ============================================================================
-- IMPORTANTE:
--   - Este arquivo contém APENAS consultas SELECT e blocos de teste dentro de
--     transações que terminam obrigatoriamente em ROLLBACK.
--   - Nenhum objeto do banco é criado, alterado ou removido por este script.
--   - Execute cada seção no SQL Editor do Supabase e compare a saída com o
--     "Resultado esperado" documentado acima de cada consulta.
-- ============================================================================


-- ============================================================================
-- 1. TABELAS DO SCHEMA public SEM RLS ATIVADO
-- ============================================================================
-- Resultado esperado:
--   0 linhas retornadas na primeira consulta (todas as tabelas de public devem
--   ter relrowsecurity = true).
--   Na segunda consulta (visão completa), todas as 6 tabelas (restaurantes,
--   categorias, produtos, clientes, funcionarios, pedidos, itens_pedido) devem
--   exibir rls_ativo = true.
-- ============================================================================

-- 1.1 Tabelas vulneráveis (sem RLS habilitado): deve retornar 0 linhas
SELECT
  n.nspname AS schema_nome,
  c.relname AS tabela_nome,
  c.relrowsecurity AS rls_ativo,
  c.relforcerowsecurity AS rls_forcado_para_owner
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = false
ORDER BY c.relname;

-- 1.2 Visão geral de RLS em todas as tabelas do schema public
SELECT
  c.relname AS tabela_nome,
  c.relrowsecurity AS rls_ativo,
  c.relforcerowsecurity AS rls_forcado_para_owner
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;


-- ============================================================================
-- 2. POLÍTICAS RLS DO SCHEMA public
-- ============================================================================
-- Resultado esperado:
--   Lista completa das políticas de restaurantes, categorias, produtos,
--   clientes, funcionarios, pedidos e itens_pedido:
--   - Leitura anônima/autenticada restrita a registros ativos em restaurantes,
--     categorias e produtos.
--   - Escrita de catálogo (categorias, produtos) restrita a public.eh_admin.
--   - Leitura/edição de clientes restrita a usuario_id = auth.uid() ou equipe.
--   - Leitura de pedidos restrita ao próprio cliente (cliente_id -> auth.uid())
--     ou funcionário ativo do restaurante (public.eh_funcionario).
--   - Atualização de pedidos restrita a funcionário ativo do restaurante.
--   - Nenhuma política de INSERT direto em pedidos/itens_pedido para clientes
--     (criação ocorre exclusivamente via RPC public.criar_pedido).
-- ============================================================================

SELECT
  schemaname AS schema_nome,
  tablename AS tabela_nome,
  policyname AS politica_nome,
  permissive AS tipo_permissao,
  cmd AS comando,
  roles AS papeis,
  qual AS expressao_using,
  with_check AS expressao_with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;


-- ============================================================================
-- 3. PRIVILÉGIOS DE TABELAS E COLUNAS PARA anon E authenticated
-- ============================================================================
-- Resultado esperado:
--   Na consulta 3.1 (escrita para anon):
--     Caso o Supabase conceda GRANT padrão em tabelas de public ao papel anon,
--     o RLS (Seção 1 e 2) DEVE estar ativo em 100% das tabelas e sem nenhuma
--     política FOR INSERT/UPDATE/DELETE para anon. Idealmente, revogar escrita
--     direta de anon ou confirmar que nenhuma política RLS permite escrita.
--   Na consulta 3.2:
--     Listagem completa dos privilégios por tabela e papel.
--   Na consulta 3.3:
--     Listagem dos privilégios em nível de coluna.
-- ============================================================================

-- 3.1 Destaque de privilégios de ESCRITA concedidos ao papel anon em public
SELECT
  table_schema AS schema_nome,
  table_name AS tabela_nome,
  grantee AS papel,
  privilege_type AS privilegio
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee = 'anon'
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
ORDER BY table_name, privilege_type;

-- 3.2 Todos os privilégios de tabela para anon e authenticated em public
SELECT
  table_schema AS schema_nome,
  table_name AS tabela_nome,
  grantee AS papel,
  string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privilegios
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
GROUP BY table_schema, table_name, grantee
ORDER BY table_name, grantee;

-- 3.3 Privilégios de coluna para anon e authenticated em public
SELECT
  table_schema AS schema_nome,
  table_name AS tabela_nome,
  column_name AS coluna_nome,
  grantee AS papel,
  string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privilegios
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
GROUP BY table_schema, table_name, column_name, grantee
ORDER BY table_name, column_name, grantee;


-- ============================================================================
-- 4. FUNÇÕES SECURITY DEFINER, search_path E PERMISSÕES DE EXECUÇÃO (EXECUTE)
-- ============================================================================
-- Resultado esperado:
--   4.1 Todas as funções SECURITY DEFINER de public (criar_pedido,
--       cancelar_pedido, admin_relatorio, eh_funcionario, eh_admin, etc.)
--       devem ter search_path_fixado = true (ex.: search_path=public).
--   4.2 Permissões de EXECUTE nas funções críticas:
--       - criar_pedido e cancelar_pedido: EXECUTE apenas para authenticated
--         (PUBLIC e anon com pode_executar = false).
--       - admin_relatorio: EXECUTE apenas para authenticated (e valida
--         public.eh_admin internamente).
--       - eh_funcionario e eh_admin: usadas nas políticas RLS para verificar
--         vínculo ativo do usuário autenticado.
-- ============================================================================

-- 4.1 Funções SECURITY DEFINER no schema public e verificação de search_path
SELECT
  n.nspname AS schema_nome,
  p.proname AS funcao_nome,
  pg_get_function_identity_arguments(p.oid) AS argumentos,
  p.prosecdef AS security_definer,
  p.proconfig AS configuracoes_funcao,
  EXISTS (
    SELECT 1
    FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) cfg
    WHERE cfg ILIKE 'search_path=%'
  ) AS search_path_fixado
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef = true
ORDER BY p.proname;

-- 4.2 Quem tem EXECUTE nas funções críticas (PUBLIC, anon, authenticated)
SELECT
  p.proname AS funcao_nome,
  pg_get_function_identity_arguments(p.oid) AS argumentos,
  has_function_privilege('public', p.oid, 'EXECUTE') AS public_pode_executar,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_pode_executar,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_pode_executar
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'criar_pedido',
    'cancelar_pedido',
    'admin_relatorio',
    'eh_funcionario',
    'eh_admin'
  )
ORDER BY p.proname;


-- ============================================================================
-- 5. STORAGE: BUCKET 'produtos' E POLÍTICAS DE storage.objects
-- ============================================================================
-- Resultado esperado:
--   5.1 O bucket 'produtos' deve existir com:
--       - public = true (para leitura pública das fotos do cardápio)
--       - file_size_limit = 2097152 (2 MB)
--       - allowed_mime_types = {image/jpeg,image/png,image/webp}
--   5.2 Políticas em storage.objects para o bucket 'produtos':
--       - SELECT permitido para leitura das imagens do bucket 'produtos'.
--       - INSERT, UPDATE e DELETE restritos a administradores ativos do
--         restaurante correspondente ao primeiro segmento do caminho
--         ((storage.foldername(name))[1]::uuid) via public.eh_admin.
-- ============================================================================

-- 5.1 Configuração do bucket 'produtos'
SELECT
  id,
  name AS nome_bucket,
  public AS publico,
  file_size_limit AS limite_bytes,
  allowed_mime_types AS mimes_permitidos,
  created_at AS criado_em
FROM storage.buckets
WHERE id = 'produtos';

-- 5.2 Políticas RLS na tabela storage.objects
SELECT
  schemaname AS schema_nome,
  tablename AS tabela_nome,
  policyname AS politica_nome,
  permissive AS tipo_permissao,
  cmd AS comando,
  roles AS papeis,
  qual AS expressao_using,
  with_check AS expressao_with_check
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
ORDER BY cmd, policyname;


-- ============================================================================
-- 6. TESTES SIMULADOS DE ISOLAMENTO RLS (COM ROLLBACK OBRIGATÓRIO)
-- ============================================================================
-- Instruções antes de executar os blocos 6.2, 6.3 e 6.4:
--   Substitua os marcadores abaixo por UUIDs reais do seu projeto (auth.users.id):
--     <UUID-CLIENTE-A> : auth.users.id de um cliente de teste A
--     <UUID-CLIENTE-B> : auth.users.id de um cliente de teste B (com pedidos)
--     <UUID-COZINHA>   : auth.users.id de um funcionário com papel = 'cozinha'
--   Cada bloco inicia com BEGIN e termina com ROLLBACK, garantindo que nenhuma
--   alteração persista no banco.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Teste 6.1: Papel anon
-- Resultado esperado:
--   - Leitura de restaurantes, categorias e produtos ativos: retorna linhas (> 0).
--   - Leitura de pedidos, clientes e funcionarios: retorna 0 linhas.
-- ----------------------------------------------------------------------------
BEGIN;

SET LOCAL ROLE anon;
SET LOCAL "request.jwt.claims" = '{}';

SELECT
  (SELECT count(*) FROM public.restaurantes WHERE ativo = true) AS restaurantes_visiveis_anon,
  (SELECT count(*) FROM public.categorias WHERE ativo = true)   AS categorias_visiveis_anon,
  (SELECT count(*) FROM public.produtos WHERE ativo = true)     AS produtos_visiveis_anon,
  (SELECT count(*) FROM public.pedidos)                         AS pedidos_visiveis_anon_esperado_zero,
  (SELECT count(*) FROM public.clientes)                        AS clientes_visiveis_anon_esperado_zero,
  (SELECT count(*) FROM public.funcionarios)                    AS funcionarios_visiveis_anon_esperado_zero;

ROLLBACK;


-- ----------------------------------------------------------------------------
-- Teste 6.2: Cliente A autenticado tentando ler pedidos do Cliente B
-- Substitua <UUID-CLIENTE-A> e <UUID-CLIENTE-B> antes de executar.
-- Resultado esperado:
--   - pedidos_do_cliente_b_vistos_pelo_cliente_a = 0
-- ----------------------------------------------------------------------------
/*
BEGIN;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "<UUID-CLIENTE-A>", "role": "authenticated"}';

SELECT
  count(*) AS pedidos_do_cliente_b_vistos_pelo_cliente_a
FROM public.pedidos p
JOIN public.clientes c ON c.id = p.cliente_id
WHERE c.usuario_id = '<UUID-CLIENTE-B>'::uuid;

ROLLBACK;
*/


-- ----------------------------------------------------------------------------
-- Teste 6.3: Cliente A tentando alterar status de pedido ou preço de produto
-- Substitua <UUID-CLIENTE-A> antes de executar.
-- Resultado esperado:
--   - pedidos_alterados_pelo_cliente = 0
--   - produtos_alterados_pelo_cliente = 0
-- ----------------------------------------------------------------------------
/*
BEGIN;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "<UUID-CLIENTE-A>", "role": "authenticated"}';

WITH tentativa_pedido AS (
  UPDATE public.pedidos
  SET status = 'entregue'
  RETURNING id
),
tentativa_produto AS (
  UPDATE public.produtos
  SET preco_centavos = 1
  RETURNING id
)
SELECT
  (SELECT count(*) FROM tentativa_pedido)  AS pedidos_alterados_pelo_cliente_esperado_zero,
  (SELECT count(*) FROM tentativa_produto) AS produtos_alterados_pelo_cliente_esperado_zero;

ROLLBACK;
*/


-- ----------------------------------------------------------------------------
-- Teste 6.4: Funcionário com papel 'cozinha' tentando alterar catálogo ou
--            chamar admin_relatorio
-- Substitua <UUID-COZINHA> antes de executar.
-- Resultado esperado:
--   - produtos_alterados_pela_cozinha = 0
--   - A chamada a public.admin_relatorio(...) deve lançar erro "Acesso negado"
-- ----------------------------------------------------------------------------
/*
BEGIN;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "<UUID-COZINHA>", "role": "authenticated"}';

WITH tentativa_catalogo AS (
  UPDATE public.produtos
  SET preco_centavos = preco_centavos + 100
  RETURNING id
)
SELECT
  (SELECT count(*) FROM tentativa_catalogo) AS produtos_alterados_pela_cozinha_esperado_zero;

-- Descomente a linha abaixo para confirmar que admin_relatorio lança exceção "Acesso negado":
-- SELECT public.admin_relatorio((SELECT id FROM public.restaurantes LIMIT 1), current_date - 7, current_date);

ROLLBACK;
*/


-- ============================================================================
-- 7. AUDITORIA DE FUNCIONÁRIOS E ADMINISTRADORES CADASTRADOS
-- ============================================================================
-- Resultado esperado:
--   Apenas funcionários e administradores legítimos e reconhecidos pelo dono
--   do restaurante devem constar nesta lista. Verifique se não há contas de
--   teste esquecidas com papel = 'admin' e ativo = true.
-- ============================================================================

SELECT
  f.id AS funcionario_id,
  f.usuario_id,
  u.email AS email_auth,
  r.nome AS restaurante_nome,
  r.slug AS restaurante_slug,
  f.nome AS funcionario_nome,
  f.papel,
  f.ativo,
  f.criado_em
FROM public.funcionarios f
JOIN public.restaurantes r ON r.id = f.restaurante_id
LEFT JOIN auth.users u ON u.id = f.usuario_id
ORDER BY r.nome, f.papel, f.ativo DESC, f.nome;
