-- =====================================================================
-- 02_rls.sql  |  FASE 1  |  Row Level Security e privilégios
-- Princípio: negar tudo por padrão e liberar só o necessário.
-- Reexecutável (DROP POLICY IF EXISTS antes de cada CREATE POLICY).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Funções auxiliares
-- SECURITY DEFINER: leem "funcionarios" ignorando o RLS dela (evita
-- recursão de políticas). search_path fixo impede sequestro de objetos.
-- Só consideram funcionários com ativo = true.
-- ---------------------------------------------------------------------
create or replace function public.eh_funcionario(restaurante uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.funcionarios f
    where f.id = auth.uid()
      and f.restaurante_id = restaurante
      and f.ativo = true
  );
$$;

create or replace function public.eh_admin(restaurante uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.funcionarios f
    where f.id = auth.uid()
      and f.restaurante_id = restaurante
      and f.papel = 'admin'
      and f.ativo = true
  );
$$;

revoke all on function public.eh_funcionario(uuid) from public, anon;
revoke all on function public.eh_admin(uuid) from public, anon;
grant execute on function public.eh_funcionario(uuid) to authenticated;
grant execute on function public.eh_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Ativa RLS em TODAS as tabelas
-- ---------------------------------------------------------------------
alter table public.restaurantes    enable row level security;
alter table public.categorias      enable row level security;
alter table public.produtos        enable row level security;
alter table public.perfis_clientes enable row level security;
alter table public.funcionarios    enable row level security;
alter table public.pedidos         enable row level security;
alter table public.itens_pedido    enable row level security;

-- ---------------------------------------------------------------------
-- Privilégios (GRANT/REVOKE): segunda camada de defesa, além do RLS.
-- O Supabase concede tudo a anon/authenticated por padrão; removemos
-- primeiro e devolvemos só o necessário.
-- ---------------------------------------------------------------------
revoke all on public.restaurantes, public.categorias, public.produtos,
              public.perfis_clientes, public.funcionarios,
              public.pedidos, public.itens_pedido
  from anon, authenticated;

-- Cardápio: leitura pública; escrita liberada ao role authenticated mas
-- as políticas só deixam passar admin do restaurante.
grant select on public.restaurantes, public.categorias, public.produtos to anon;
grant select, insert, update, delete
  on public.restaurantes, public.categorias, public.produtos to authenticated;

-- Dados sensíveis: anon não recebe nada.
grant select, insert, update on public.perfis_clientes to authenticated;  -- sem DELETE
grant select on public.funcionarios to authenticated;                     -- sem escrita
grant select on public.pedidos, public.itens_pedido to authenticated;
-- UPDATE em pedidos restrito à coluna status (cozinha só muda status;
-- não pode alterar total, cliente, senha etc.).
grant update (status) on public.pedidos to authenticated;

-- ---------------------------------------------------------------------
-- restaurantes
-- Público vê só ativos; funcionário vê o próprio mesmo se inativo.
-- ---------------------------------------------------------------------
drop policy if exists restaurantes_select on public.restaurantes;
create policy restaurantes_select on public.restaurantes
  for select to anon, authenticated
  using (ativo = true or public.eh_funcionario(id));

drop policy if exists restaurantes_insert on public.restaurantes;
-- Criar restaurantes novos é tarefa de plataforma (feita no SQL Editor),
-- por isso NÃO há política de INSERT: ninguém cria via API.

drop policy if exists restaurantes_update on public.restaurantes;
create policy restaurantes_update on public.restaurantes
  for update to authenticated
  using (public.eh_admin(id))
  with check (public.eh_admin(id));

drop policy if exists restaurantes_delete on public.restaurantes;
-- Sem política de DELETE: apagar restaurante é operação administrativa.

-- ---------------------------------------------------------------------
-- categorias
-- ---------------------------------------------------------------------
drop policy if exists categorias_select on public.categorias;
create policy categorias_select on public.categorias
  for select to anon, authenticated
  using (
    (ativa = true and exists (
      select 1 from public.restaurantes r
      where r.id = categorias.restaurante_id and r.ativo = true))
    or public.eh_funcionario(restaurante_id)
  );

drop policy if exists categorias_insert on public.categorias;
create policy categorias_insert on public.categorias
  for insert to authenticated
  with check (public.eh_admin(restaurante_id));

drop policy if exists categorias_update on public.categorias;
create policy categorias_update on public.categorias
  for update to authenticated
  using (public.eh_admin(restaurante_id))
  with check (public.eh_admin(restaurante_id));

drop policy if exists categorias_delete on public.categorias;
create policy categorias_delete on public.categorias
  for delete to authenticated
  using (public.eh_admin(restaurante_id));

-- ---------------------------------------------------------------------
-- produtos
-- ---------------------------------------------------------------------
drop policy if exists produtos_select on public.produtos;
create policy produtos_select on public.produtos
  for select to anon, authenticated
  using (
    (disponivel = true and exists (
      select 1 from public.restaurantes r
      where r.id = produtos.restaurante_id and r.ativo = true))
    or public.eh_funcionario(restaurante_id)
  );

drop policy if exists produtos_insert on public.produtos;
create policy produtos_insert on public.produtos
  for insert to authenticated
  with check (public.eh_admin(restaurante_id));

drop policy if exists produtos_update on public.produtos;
create policy produtos_update on public.produtos
  for update to authenticated
  using (public.eh_admin(restaurante_id))
  with check (public.eh_admin(restaurante_id));

drop policy if exists produtos_delete on public.produtos;
create policy produtos_delete on public.produtos
  for delete to authenticated
  using (public.eh_admin(restaurante_id));

-- ---------------------------------------------------------------------
-- perfis_clientes: cada usuário mexe só na própria linha; sem DELETE.
-- ---------------------------------------------------------------------
drop policy if exists perfis_select_proprio on public.perfis_clientes;
create policy perfis_select_proprio on public.perfis_clientes
  for select to authenticated
  using (id = auth.uid());

drop policy if exists perfis_insert_proprio on public.perfis_clientes;
create policy perfis_insert_proprio on public.perfis_clientes
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists perfis_update_proprio on public.perfis_clientes;
create policy perfis_update_proprio on public.perfis_clientes
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------
-- funcionarios: só leitura da própria linha; escrita só pelo SQL Editor.
-- ---------------------------------------------------------------------
drop policy if exists funcionarios_select_proprio on public.funcionarios;
create policy funcionarios_select_proprio on public.funcionarios
  for select to authenticated
  using (id = auth.uid());

-- ---------------------------------------------------------------------
-- pedidos
-- SEM política de INSERT/DELETE: pedidos nascem só em criar_pedido()
-- (SECURITY DEFINER), onde preço e senha são calculados no servidor.
-- ---------------------------------------------------------------------
drop policy if exists pedidos_select on public.pedidos;
create policy pedidos_select on public.pedidos
  for select to authenticated
  using (cliente_id = auth.uid() or public.eh_funcionario(restaurante_id));

drop policy if exists pedidos_update_funcionario on public.pedidos;
create policy pedidos_update_funcionario on public.pedidos
  for update to authenticated
  using (public.eh_funcionario(restaurante_id))
  with check (public.eh_funcionario(restaurante_id));

-- ---------------------------------------------------------------------
-- itens_pedido: leitura se for dono do pedido ou funcionário do
-- restaurante dele. Sem escrita direta.
-- ---------------------------------------------------------------------
drop policy if exists itens_pedido_select on public.itens_pedido;
create policy itens_pedido_select on public.itens_pedido
  for select to authenticated
  using (
    exists (
      select 1 from public.pedidos p
      where p.id = itens_pedido.pedido_id
        and (p.cliente_id = auth.uid() or public.eh_funcionario(p.restaurante_id))
    )
  );
