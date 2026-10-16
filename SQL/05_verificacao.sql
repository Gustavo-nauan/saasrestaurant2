-- =====================================================================
-- 05_verificacao.sql  |  FASE 1  |  Roteiro de testes manuais
-- Rode cada consulta separadamente no SQL Editor e confira o resultado.
-- Não altera dados permanentes (os testes de simulação usam ROLLBACK).
-- =====================================================================

-- (1) Todas as tabelas existem? Esperado: 7 linhas.
select tablename
from pg_tables
where schemaname = 'public'
  and tablename in ('restaurantes','categorias','produtos','perfis_clientes',
                    'funcionarios','pedidos','itens_pedido')
order by tablename;

-- (2) RLS ativo em todas? Esperado: rls_ativo = true em todas as 7.
select c.relname as tabela, c.relrowsecurity as rls_ativo
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('restaurantes','categorias','produtos','perfis_clientes',
                    'funcionarios','pedidos','itens_pedido')
order by c.relname;

-- (3) Políticas criadas. Confira: pedidos e itens_pedido NÃO podem ter
-- política de INSERT nem DELETE; perfis_clientes não pode ter DELETE.
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;

-- (4) pedidos está na publicação do Realtime? Esperado: 1 linha.
select pubname, schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'pedidos';

-- (4b) Privilégios de coluna em pedidos: esperado só "status" com UPDATE
-- para authenticated.
select grantee, column_name, privilege_type
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'pedidos'
  and grantee in ('anon','authenticated') and privilege_type = 'UPDATE';

-- (5) SIMULAÇÃO DE CLIENTES AUTENTICADOS
-- Passo A: crie 2 usuários no painel Authentication e copie os UUIDs.
-- Passo B (como postgres, no SQL Editor): crie os perfis:
--   insert into public.perfis_clientes (id, nome) values
--     ('<UUID-CLIENTE-A>', 'Cliente A'),
--     ('<UUID-CLIENTE-B>', 'Cliente B')
--   on conflict (id) do nothing;
-- Passo C: rode o bloco abaixo INTEIRO de uma vez (descomente e troque
-- os UUIDs). O set local só vale dentro da transação; o ROLLBACK no fim
-- desfaz o pedido de teste.
--
-- begin;
--
--   -- Atua como Cliente A
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<UUID-CLIENTE-A>","role":"authenticated"}';
--
--   -- Cria pedido: preço vem do servidor. Deve retornar id, senha e total.
--   select * from public.criar_pedido(
--     (select id from public.restaurantes where slug = 'cantinho-do-sabor'),
--     'mesa', '5', 'sem pressa',
--     jsonb_build_array(jsonb_build_object(
--       'produto_id', (select id from public.produtos where nome = 'X-Burguer'),
--       'quantidade', 2, 'observacao', 'sem cebola'))
--   );
--
--   -- Cliente A enxerga o próprio pedido (esperado: 1 linha)
--   select id, senha, status, total_centavos from public.pedidos;
--
--   -- Troca para Cliente B
--   set local request.jwt.claims = '{"sub":"<UUID-CLIENTE-B>","role":"authenticated"}';
--
--   -- Cliente B NÃO enxerga pedidos do A (esperado: 0 linhas)
--   select count(*) as pedidos_visiveis_para_B from public.pedidos;
--   select count(*) as itens_visiveis_para_B from public.itens_pedido;
--
--   -- Cliente B tentando inserir direto deve falhar (sem política/privilégio)
--   -- insert into public.pedidos (...) values (...);  -- esperado: erro
--
-- rollback;
--
-- Testes de erro esperados (dentro de um bloco como acima):
--   * carrinho vazio:      jsonb '[]'            -> "O carrinho está vazio."
--   * quantidade 21:       -> "Quantidade inválida..."
--   * mesa sem número:     tipo 'mesa', p_mesa null -> erro de mesa
--   * como anon (set local role anon) chamar criar_pedido -> permission denied
