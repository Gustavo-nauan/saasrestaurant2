-- =====================================================================
-- 01_schema.sql  |  FASE 1  |  Tabelas, índices, triggers e Realtime
-- Reexecutável: usa IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS.
-- Valores monetários SEMPRE em centavos (integer) para evitar erros de
-- arredondamento de ponto flutuante.
-- =====================================================================

-- gen_random_uuid() vem do pgcrypto (no Postgres 13+ já é nativo, mas
-- garantimos a extensão por segurança).
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. restaurantes
-- Base do modelo multi-restaurante: todo o resto aponta para cá.
-- ---------------------------------------------------------------------
create table if not exists public.restaurantes (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  slug      text not null unique,          -- usado na URL/QR code do restaurante
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. categorias
-- UNIQUE (restaurante_id, nome) permite seed idempotente com ON CONFLICT.
-- ---------------------------------------------------------------------
create table if not exists public.categorias (
  id             uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  nome           text not null,
  ordem          integer not null default 0,
  ativa          boolean not null default true,
  unique (restaurante_id, nome)
);

-- ---------------------------------------------------------------------
-- 3. produtos
-- preco_centavos com CHECK >= 0 (nunca negativo).
-- ---------------------------------------------------------------------
create table if not exists public.produtos (
  id             uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  categoria_id   uuid not null references public.categorias(id) on delete restrict,
  nome           text not null,
  descricao      text,
  preco_centavos integer not null check (preco_centavos >= 0),
  imagem_url     text,
  disponivel     boolean not null default true,
  ordem          integer not null default 0,
  criado_em      timestamptz not null default now(),
  unique (restaurante_id, nome)
);

-- ---------------------------------------------------------------------
-- 4. perfis_clientes
-- Extensão de auth.users; apagar o usuário apaga o perfil (CASCADE).
-- ---------------------------------------------------------------------
create table if not exists public.perfis_clientes (
  id        uuid primary key references auth.users(id) on delete cascade,
  nome      text not null,
  telefone  text,
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. funcionarios
-- Quem é 'cozinha' ou 'admin' de qual restaurante. Só ativo = true vale.
-- ---------------------------------------------------------------------
create table if not exists public.funcionarios (
  id             uuid primary key references auth.users(id) on delete cascade,
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  nome           text not null,
  papel          text not null check (papel in ('cozinha', 'admin')),
  ativo          boolean not null default true
);

-- ---------------------------------------------------------------------
-- 6. pedidos
-- data_dia: dia do pedido no fuso de São Paulo. Existe para viabilizar um
-- UNIQUE (restaurante_id, data_dia, senha) simples e indexável (expressões
-- com timestamptz->date não são IMMUTABLE e não servem em índice).
-- A função criar_pedido preenche explicitamente; o default é só reserva.
-- ---------------------------------------------------------------------
create table if not exists public.pedidos (
  id              uuid primary key default gen_random_uuid(),
  restaurante_id  uuid not null references public.restaurantes(id) on delete restrict,
  cliente_id      uuid not null references public.perfis_clientes(id) on delete restrict,
  senha           integer not null,
  data_dia        date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  tipo_entrega    text not null check (tipo_entrega in ('retirada_balcao', 'mesa')),
  mesa            text,
  observacao      text,
  status          text not null default 'recebido'
                  check (status in ('recebido', 'em_preparo', 'pronto', 'finalizado', 'cancelado')),
  total_centavos  integer not null default 0 check (total_centavos >= 0),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  pronto_em       timestamptz,
  -- Mesa obrigatória (e não vazia) quando o pedido é para a mesa.
  constraint pedidos_mesa_obrigatoria check (
    tipo_entrega <> 'mesa' or (mesa is not null and length(btrim(mesa)) > 0)
  ),
  -- Garante senha única por restaurante por dia, mesmo sob concorrência.
  constraint pedidos_senha_unica_dia unique (restaurante_id, data_dia, senha)
);

-- ---------------------------------------------------------------------
-- 7. itens_pedido
-- Guarda snapshot de nome e preço: mudanças futuras no cardápio não
-- alteram pedidos já feitos.
-- ---------------------------------------------------------------------
create table if not exists public.itens_pedido (
  id                      uuid primary key default gen_random_uuid(),
  pedido_id               uuid not null references public.pedidos(id) on delete cascade,
  produto_id              uuid not null references public.produtos(id) on delete restrict,
  nome_snapshot           text not null,
  preco_unitario_centavos integer not null check (preco_unitario_centavos >= 0),
  quantidade              integer not null check (quantidade between 1 and 20),
  observacao              text
);

-- ---------------------------------------------------------------------
-- Índices (suportam o painel da cozinha, "meus pedidos" e o cardápio)
-- ---------------------------------------------------------------------
create index if not exists idx_pedidos_rest_status_criado
  on public.pedidos (restaurante_id, status, criado_em);
create index if not exists idx_pedidos_cliente_criado
  on public.pedidos (cliente_id, criado_em desc);
create index if not exists idx_produtos_rest_categoria
  on public.produtos (restaurante_id, categoria_id);
create index if not exists idx_itens_pedido_pedido
  on public.itens_pedido (pedido_id);

-- ---------------------------------------------------------------------
-- Trigger: atualizado_em automático em pedidos
-- ---------------------------------------------------------------------
create or replace function public.trg_pedidos_atualizado_em()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists pedidos_atualizado_em on public.pedidos;
create trigger pedidos_atualizado_em
  before update on public.pedidos
  for each row execute function public.trg_pedidos_atualizado_em();

-- ---------------------------------------------------------------------
-- Trigger: valida a máquina de estados do pedido
--   recebido -> em_preparo -> pronto -> finalizado
--   cancelado somente a partir de recebido ou em_preparo
-- Está no banco (e não no front) para ninguém burlar via API.
-- Ao entrar em 'pronto', preenche pronto_em.
-- ---------------------------------------------------------------------
create or replace function public.trg_pedidos_valida_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Sem mudança de status: nada a validar.
  if new.status is not distinct from old.status then
    return new;
  end if;

  if not (
       (old.status = 'recebido'   and new.status in ('em_preparo', 'cancelado'))
    or (old.status = 'em_preparo' and new.status in ('pronto', 'cancelado'))
    or (old.status = 'pronto'     and new.status = 'finalizado')
  ) then
    raise exception 'Transição de status inválida: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status = 'pronto' then
    new.pronto_em := now();
  end if;

  return new;
end;
$$;

drop trigger if exists pedidos_valida_status on public.pedidos;
create trigger pedidos_valida_status
  before update on public.pedidos
  for each row execute function public.trg_pedidos_valida_status();

-- ---------------------------------------------------------------------
-- Realtime: publica a tabela pedidos (cozinha e cliente recebem eventos).
-- O bloco DO evita erro se já estiver na publicação.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pedidos'
  ) then
    alter publication supabase_realtime add table public.pedidos;
  end if;
end;
$$;
