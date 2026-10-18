-- =====================================================================
-- 08_admin_relatorio.sql  |  FASE 5.2  |  Relatório de pedidos do Admin
-- Reexecutável: usa CREATE INDEX IF NOT EXISTS e CREATE OR REPLACE FUNCTION.
-- Depende de: 01_schema.sql e 02_rls.sql (reutiliza public.eh_admin(uuid)).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Índice para listagem e agregação de pedidos por restaurante e período
-- ---------------------------------------------------------------------
create index if not exists idx_pedidos_rest_criado_desc
  on public.pedidos (restaurante_id, criado_em desc);

-- ---------------------------------------------------------------------
-- 2. Função RPC admin_relatorio
-- Devolve um jsonb com:
--   - por_status: objeto com { recebido, em_preparo, pronto, finalizado, cancelado },
--     cada um contendo { quantidade, total_centavos }
--   - faturamento_centavos: soma de total_centavos dos pedidos finalizados
--   - ticket_medio_centavos: faturamento_centavos / qtd finalizados (0 se nenhum)
--   - por_dia: lista de { dia, quantidade, total_centavos } em todos os dias do
--     intervalo no fuso informado (dias sem vendas vêm com 0)
--   - top_produtos: até 10 itens agrupados por nome_snapshot nos pedidos
--     finalizados, com { nome, quantidade, receita_centavos }
-- ---------------------------------------------------------------------
create or replace function public.admin_relatorio(
  p_restaurante_id uuid,
  p_inicio timestamptz,
  p_fim timestamptz,
  p_fuso text default 'America/Sao_Paulo'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fuso text := coalesce(nullif(btrim(p_fuso), ''), 'America/Sao_Paulo');
  v_fuso_valido boolean;
  v_dia_inicial date;
  v_dia_final date;
  v_por_status jsonb;
  v_qtd_finalizados bigint := 0;
  v_faturamento_centavos bigint := 0;
  v_ticket_medio_centavos bigint := 0;
  v_por_dia jsonb;
  v_top_produtos jsonb;
begin
  -- 1. Controle de acesso: somente admin ativo do restaurante
  if p_restaurante_id is null or not public.eh_admin(p_restaurante_id) then
    raise exception 'Acesso negado'
      using errcode = '42501';
  end if;

  -- 2. Validação do intervalo de datas
  if p_inicio is null or p_fim is null then
    raise exception 'Informe a data inicial e a data final do período.'
      using errcode = '22023';
  end if;

  if p_inicio >= p_fim then
    raise exception 'A data inicial deve ser anterior à data final.'
      using errcode = '22023';
  end if;

  if (p_fim - p_inicio) > interval '366 days 2 hours' then
    raise exception 'O período máximo permitido para o relatório é de 366 dias.'
      using errcode = '22023';
  end if;

  -- 3. Validação segura do fuso horário (fallback para America/Sao_Paulo)
  select exists (
    select 1 from pg_timezone_names where name = v_fuso
  ) into v_fuso_valido;

  if not coalesce(v_fuso_valido, false) then
    v_fuso := 'America/Sao_Paulo';
  end if;

  -- 4. Resumo por status (garante todas as 5 chaves mesmo com zero pedidos)
  with status_base as (
    select unnest(array['recebido', 'em_preparo', 'pronto', 'finalizado', 'cancelado']) as status
  ),
  agregado as (
    select
      p.status,
      count(*)::bigint as quantidade,
      coalesce(sum(p.total_centavos), 0)::bigint as total_centavos
    from public.pedidos p
    where p.restaurante_id = p_restaurante_id
      and p.criado_em >= p_inicio
      and p.criado_em < p_fim
    group by p.status
  )
  select
    jsonb_object_agg(
      sb.status,
      jsonb_build_object(
        'quantidade', coalesce(a.quantidade, 0),
        'total_centavos', coalesce(a.total_centavos, 0)
      )
    )
  into v_por_status
  from status_base sb
  left join agregado a on a.status = sb.status;

  v_qtd_finalizados := coalesce((v_por_status -> 'finalizado' ->> 'quantidade')::bigint, 0);
  v_faturamento_centavos := coalesce((v_por_status -> 'finalizado' ->> 'total_centavos')::bigint, 0);

  if v_qtd_finalizados > 0 then
    v_ticket_medio_centavos := round(v_faturamento_centavos::numeric / v_qtd_finalizados::numeric)::bigint;
  else
    v_ticket_medio_centavos := 0;
  end if;

  -- 5. Vendas por dia (pedidos finalizados por dia no fuso informado, preenchendo zeros)
  v_dia_inicial := (p_inicio at time zone v_fuso)::date;
  v_dia_final   := ((p_fim - interval '1 microsecond') at time zone v_fuso)::date;
  if v_dia_final < v_dia_inicial then
    v_dia_final := v_dia_inicial;
  end if;

  with serie_dias as (
    select generate_series(v_dia_inicial, v_dia_final, interval '1 day')::date as dia
  ),
  vendas_dia as (
    select
      (p.criado_em at time zone v_fuso)::date as dia,
      count(*)::bigint as quantidade,
      coalesce(sum(p.total_centavos), 0)::bigint as total_centavos
    from public.pedidos p
    where p.restaurante_id = p_restaurante_id
      and p.criado_em >= p_inicio
      and p.criado_em < p_fim
      and p.status = 'finalizado'
    group by (p.criado_em at time zone v_fuso)::date
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'dia', to_char(sd.dia, 'YYYY-MM-DD'),
        'quantidade', coalesce(vd.quantidade, 0),
        'total_centavos', coalesce(vd.total_centavos, 0)
      )
      order by sd.dia asc
    ),
    '[]'::jsonb
  )
  into v_por_dia
  from serie_dias sd
  left join vendas_dia vd on vd.dia = sd.dia;

  -- 6. Top 10 produtos mais vendidos nos pedidos finalizados do período
  with ranking as (
    select
      ip.nome_snapshot as nome,
      coalesce(sum(ip.quantidade), 0)::bigint as quantidade,
      coalesce(sum(ip.quantidade::bigint * ip.preco_unitario_centavos::bigint), 0)::bigint as receita_centavos
    from public.itens_pedido ip
    inner join public.pedidos p on p.id = ip.pedido_id
    where p.restaurante_id = p_restaurante_id
      and p.criado_em >= p_inicio
      and p.criado_em < p_fim
      and p.status = 'finalizado'
    group by ip.nome_snapshot
    order by quantidade desc, receita_centavos desc, ip.nome_snapshot asc
    limit 10
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'nome', r.nome,
        'quantidade', r.quantidade,
        'receita_centavos', r.receita_centavos
      )
    ),
    '[]'::jsonb
  )
  into v_top_produtos
  from ranking r;

  return jsonb_build_object(
    'por_status', v_por_status,
    'faturamento_centavos', v_faturamento_centavos,
    'ticket_medio_centavos', v_ticket_medio_centavos,
    'por_dia', v_por_dia,
    'top_produtos', v_top_produtos
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Permissões da função admin_relatorio
-- ---------------------------------------------------------------------
revoke all on function public.admin_relatorio(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.admin_relatorio(uuid, timestamptz, timestamptz, text) to authenticated;
