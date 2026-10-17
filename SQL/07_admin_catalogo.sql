-- =====================================================================
-- 07_admin_catalogo.sql  |  FASE 5.1  |  Catálogo e Storage do Admin
-- Reexecutável: pode ser rodado mais de uma vez no SQL Editor do Supabase
-- sem gerar erros de objetos duplicados.
-- Depende de: 01_schema.sql e 02_rls.sql (reutiliza public.eh_admin(uuid)).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Privilégios nas tabelas do catálogo (categorias e produtos)
-- Leitura liberada para anon e authenticated; escrita para authenticated
-- (as políticas de RLS em 02_rls.sql restringem INSERT/UPDATE/DELETE ao
-- administrador ativo do restaurante via public.eh_admin(restaurante_id)).
-- ---------------------------------------------------------------------
grant select on public.categorias, public.produtos to anon, authenticated;
grant insert, update, delete on public.categorias, public.produtos to authenticated;

-- ---------------------------------------------------------------------
-- 2. Bucket de Storage "produtos"
-- Público para leitura (as fotos aparecem direto no cardápio do cliente),
-- limite de 2 MB (2097152 bytes) por arquivo e apenas formatos de imagem
-- permitidos (JPEG, PNG e WEBP).
-- ---------------------------------------------------------------------
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'produtos',
  'produtos',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------
-- 3. Políticas de RLS em storage.objects para o bucket "produtos"
-- Convenção de caminho: "RESTAURANTE_ID/nome_do_arquivo.ext"
-- O primeiro segmento (split_part(name, '/', 1)) identifica o restaurante.
-- Usamos CASE WHEN com expressão regular de UUID antes do cast ::uuid
-- para garantir que caminhos malformados nunca disparem erro de conversão.
-- ---------------------------------------------------------------------

-- Leitura pública das fotos do bucket "produtos"
drop policy if exists storage_produtos_select on storage.objects;
create policy storage_produtos_select on storage.objects
  for select
  to public
  using (bucket_id = 'produtos');

-- Upload (INSERT) restrito ao admin ativo do restaurante dono da pasta
drop policy if exists storage_produtos_insert on storage.objects;
create policy storage_produtos_insert on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'produtos'
    and case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and split_part(name, '/', 2) <> ''
      then public.eh_admin((split_part(name, '/', 1))::uuid)
      else false
    end
  );

-- Atualização (UPDATE) restrita ao admin ativo do restaurante dono da pasta
drop policy if exists storage_produtos_update on storage.objects;
create policy storage_produtos_update on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'produtos'
    and case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and split_part(name, '/', 2) <> ''
      then public.eh_admin((split_part(name, '/', 1))::uuid)
      else false
    end
  )
  with check (
    bucket_id = 'produtos'
    and case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and split_part(name, '/', 2) <> ''
      then public.eh_admin((split_part(name, '/', 1))::uuid)
      else false
    end
  );

-- Exclusão (DELETE) restrita ao admin ativo do restaurante dono da pasta
drop policy if exists storage_produtos_delete on storage.objects;
create policy storage_produtos_delete on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'produtos'
    and case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and split_part(name, '/', 2) <> ''
      then public.eh_admin((split_part(name, '/', 1))::uuid)
      else false
    end
  );
