-- =====================================================================
-- 03_funcoes.sql  |  FASE 1  |  Funções RPC: criar_pedido e cancelar_pedido
-- Reexecutável (CREATE OR REPLACE).
-- =====================================================================

-- ---------------------------------------------------------------------
-- criar_pedido
-- Único caminho para criar pedidos. Roda como SECURITY DEFINER para poder
-- inserir nas tabelas (que não têm política de INSERT), mas valida tudo
-- internamente. O preço vem SEMPRE da tabela produtos, nunca do cliente.
-- #variable_conflict use_column: evita ambiguidade entre as colunas de
-- retorno (senha, total_centavos) e as colunas das tabelas.
-- ---------------------------------------------------------------------
create or replace function public.criar_pedido(
  p_restaurante_id uuid,
  p_tipo_entrega   text,
  p_mesa           text,
  p_observacao     text,
  p_itens          jsonb
)
returns table (id uuid, senha integer, total_centavos integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_cliente     uuid := auth.uid();
  v_item        jsonb;
  v_linhas      jsonb := '[]'::jsonb;   -- itens já validados, com snapshot
  v_produto_id  uuid;
  v_qtd         integer;
  v_obs         text;
  v_prod        public.produtos%rowtype;
  v_total       bigint := 0;
  v_hoje        date := (now() at time zone 'America/Sao_Paulo')::date;
  v_senha       integer;
  v_pedido_id   uuid;
begin
  -- 1) Autenticação e perfil
  if v_cliente is null then
    raise exception 'Você precisa estar autenticado para fazer um pedido.'
      using errcode = '28000';
  end if;

  if not exists (select 1 from public.perfis_clientes pc where pc.id = v_cliente) then
    raise exception 'Perfil de cliente não encontrado. Complete seu cadastro antes de pedir.';
  end if;

  -- 2) Restaurante ativo
  if p_restaurante_id is null or not exists (
    select 1 from public.restaurantes r where r.id = p_restaurante_id and r.ativo = true
  ) then
    raise exception 'Restaurante não encontrado ou inativo.';
  end if;

  -- 3) Tipo de entrega e mesa
  if p_tipo_entrega is null or p_tipo_entrega not in ('retirada_balcao', 'mesa') then
    raise exception 'Tipo de entrega inválido. Use retirada_balcao ou mesa.';
  end if;

  if p_tipo_entrega = 'mesa' and (p_mesa is null or length(btrim(p_mesa)) = 0) then
    raise exception 'Informe o número da mesa para pedidos na mesa.';
  end if;

  if length(coalesce(p_observacao, '')) > 500 then
    raise exception 'A observação do pedido deve ter no máximo 500 caracteres.';
  end if;

  -- 4) Carrinho
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'O carrinho está vazio.';
  end if;

  if jsonb_array_length(p_itens) > 50 then
    raise exception 'O carrinho excede o limite de 50 itens.';
  end if;

  -- 5) Valida cada item e calcula o total com preços do servidor
  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Item do carrinho em formato inválido.';
    end if;

    begin
      v_produto_id := (v_item->>'produto_id')::uuid;
    exception when others then
      raise exception 'Produto inválido no carrinho.';
    end;

    if coalesce(v_item->>'quantidade', '') !~ '^\d{1,3}$' then
      raise exception 'Quantidade inválida. Deve ser um número inteiro entre 1 e 20.';
    end if;
    v_qtd := (v_item->>'quantidade')::integer;
    if v_qtd < 1 or v_qtd > 20 then
      raise exception 'Quantidade inválida. Deve estar entre 1 e 20.';
    end if;

    v_obs := nullif(btrim(v_item->>'observacao'), '');
    if length(coalesce(v_obs, '')) > 200 then
      raise exception 'A observação do item deve ter no máximo 200 caracteres.';
    end if;

    select * into v_prod
    from public.produtos p
    where p.id = v_produto_id and p.restaurante_id = p_restaurante_id;

    if not found then
      raise exception 'Produto não pertence a este restaurante.';
    end if;
    if not v_prod.disponivel then
      raise exception 'O produto "%" não está disponível no momento.', v_prod.nome;
    end if;

    v_total := v_total + (v_prod.preco_centavos::bigint * v_qtd);

    v_linhas := v_linhas || jsonb_build_object(
      'produto_id', v_prod.id,
      'nome', v_prod.nome,
      'preco', v_prod.preco_centavos,
      'quantidade', v_qtd,
      'observacao', v_obs
    );
  end loop;

  if v_total > 2000000000 then
    raise exception 'Valor total do pedido excede o limite permitido.';
  end if;

  -- 6) Senha do dia, segura contra concorrência: o lock serializa pedidos
  -- do mesmo restaurante até o fim da transação; a constraint UNIQUE é a
  -- rede de segurança final.
  perform pg_advisory_xact_lock(hashtextextended(p_restaurante_id::text, 0));

  select coalesce(max(pd.senha), 0) + 1
    into v_senha
  from public.pedidos pd
  where pd.restaurante_id = p_restaurante_id and pd.data_dia = v_hoje;

  -- 7) Grava pedido e itens na mesma transação (a função inteira é atômica)
  insert into public.pedidos (
    restaurante_id, cliente_id, senha, data_dia, tipo_entrega, mesa,
    observacao, total_centavos
  ) values (
    p_restaurante_id, v_cliente, v_senha, v_hoje, p_tipo_entrega,
    case when p_tipo_entrega = 'mesa' then btrim(p_mesa) else null end,
    nullif(btrim(p_observacao), ''), v_total::integer
  )
  returning pedidos.id into v_pedido_id;

  insert into public.itens_pedido (
    pedido_id, produto_id, nome_snapshot, preco_unitario_centavos, quantidade, observacao
  )
  select v_pedido_id, l.produto_id, l.nome, l.preco, l.quantidade, l.observacao
  from jsonb_to_recordset(v_linhas) as l(
    produto_id uuid, nome text, preco integer, quantidade integer, observacao text
  );

  return query select v_pedido_id, v_senha, v_total::integer;
end;
$$;

revoke all on function public.criar_pedido(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.criar_pedido(uuid, text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- cancelar_pedido
-- Cliente só cancela o próprio pedido e só enquanto 'recebido' (depois
-- disso a cozinha já pode ter começado a preparar).
-- FOR UPDATE trava a linha: evita corrida com a cozinha mudando o status.
-- ---------------------------------------------------------------------
create or replace function public.cancelar_pedido(p_pedido_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido public.pedidos%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Você precisa estar autenticado para cancelar um pedido.'
      using errcode = '28000';
  end if;

  select * into v_pedido
  from public.pedidos pd
  where pd.id = p_pedido_id and pd.cliente_id = auth.uid()
  for update;

  -- Mesma mensagem para "não existe" e "é de outro cliente": não vaza info.
  if not found then
    raise exception 'Pedido não encontrado.';
  end if;

  if v_pedido.status <> 'recebido' then
    raise exception 'Este pedido não pode mais ser cancelado (status atual: %).', v_pedido.status;
  end if;

  update public.pedidos set status = 'cancelado' where id = p_pedido_id;
end;
$$;

revoke all on function public.cancelar_pedido(uuid) from public, anon;
grant execute on function public.cancelar_pedido(uuid) to authenticated;
