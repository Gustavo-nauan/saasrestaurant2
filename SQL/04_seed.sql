-- =====================================================================
-- 04_seed.sql  |  FASE 1  |  Dados de teste (reexecutável, sem duplicar)
-- Idempotência via UNIQUE: restaurantes.slug, categorias(restaurante_id,nome)
-- e produtos(restaurante_id,nome) + ON CONFLICT.
-- =====================================================================

insert into public.restaurantes (nome, slug, ativo)
values ('Cantinho do Sabor', 'cantinho-do-sabor', true)
on conflict (slug) do update set nome = excluded.nome, ativo = true;

insert into public.categorias (restaurante_id, nome, ordem, ativa)
select r.id, c.nome, c.ordem, true
from public.restaurantes r
cross join (values ('Lanches', 1), ('Bebidas', 2), ('Sobremesas', 3)) as c(nome, ordem)
where r.slug = 'cantinho-do-sabor'
on conflict (restaurante_id, nome) do update set ordem = excluded.ordem, ativa = true;

-- Preços em CENTAVOS (ex.: 2890 = R$ 28,90). imagem_url nula por enquanto.
insert into public.produtos
  (restaurante_id, categoria_id, nome, descricao, preco_centavos, imagem_url, disponivel, ordem)
select r.id, c.id, p.nome, p.descricao, p.preco, null, true, p.ordem
from public.restaurantes r
join (values
  ('Lanches',    'X-Burguer',          'Pão brioche, hambúrguer 150g, queijo prato, alface e tomate.',        2890, 1),
  ('Lanches',    'X-Bacon',            'Hambúrguer 150g, queijo, bacon crocante e maionese da casa.',         3290, 2),
  ('Lanches',    'X-Frango',           'Filé de frango grelhado, queijo, alface, tomate e maionese.',         2690, 3),
  ('Bebidas',    'Refrigerante Lata',  'Lata 350ml (cola, guaraná ou limão).',                                 650, 1),
  ('Bebidas',    'Suco Natural',       'Copo 400ml. Laranja, limão ou maracujá.',                              900, 2),
  ('Bebidas',    'Água Mineral',       'Garrafa 500ml, sem gás.',                                              400, 3),
  ('Sobremesas', 'Brownie',            'Brownie de chocolate com nozes.',                                     1200, 1),
  ('Sobremesas', 'Pudim de Leite',     'Fatia de pudim de leite condensado com calda de caramelo.',           1100, 2),
  ('Sobremesas', 'Sorvete 2 Bolas',    'Duas bolas de sorvete com cobertura à escolha.',                      1400, 3)
) as p(categoria, nome, descricao, preco, ordem) on true
join public.categorias c on c.restaurante_id = r.id and c.nome = p.categoria
where r.slug = 'cantinho-do-sabor'
on conflict (restaurante_id, nome) do update
  set descricao      = excluded.descricao,
      preco_centavos = excluded.preco_centavos,
      categoria_id   = excluded.categoria_id,
      ordem          = excluded.ordem;

-- =====================================================================
-- FUNCIONÁRIOS (modelo comentado)
-- 1) PRIMEIRO crie os usuários no painel Authentication do Supabase
--    (Authentication > Users > Add user), copie o UUID de cada um
--    e preencha abaixo no lugar dos textos entre < >.
-- 2) Descomente o bloco e execute.
-- =====================================================================
-- insert into public.funcionarios (id, restaurante_id, nome, papel, ativo)
-- select v.id::uuid, r.id, v.nome, v.papel, true
-- from public.restaurantes r
-- cross join (values
--   ('<UUID-DO-USUARIO-COZINHA>', 'Maria (Cozinha)', 'cozinha'),
--   ('<UUID-DO-USUARIO-ADMIN>',   'João (Admin)',    'admin')
-- ) as v(id, nome, papel)
-- where r.slug = 'cantinho-do-sabor'
-- on conflict (id) do update
--   set restaurante_id = excluded.restaurante_id,
--       nome = excluded.nome,
--       papel = excluded.papel,
--       ativo = true;
