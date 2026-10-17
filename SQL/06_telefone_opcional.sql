-- =====================================================================
-- 06_telefone_opcional.sql  |  FASE 3.2  |  Telefone deixa de ser obrigatório
-- MOTIVO: o cadastro do cliente passou a pedir só nome, e-mail e senha.
-- Se a coluna perfis_clientes.telefone ainda estiver como NOT NULL no seu
-- banco, o perfil novo (sem telefone) seria recusado. Este comando remove
-- a obrigatoriedade; perfis antigos que já têm telefone continuam intactos.
-- Reexecutável: DROP NOT NULL numa coluna já opcional não dá erro.
-- Execute no SQL Editor do Supabase.
-- =====================================================================

ALTER TABLE public.perfis_clientes ALTER COLUMN telefone DROP NOT NULL;
