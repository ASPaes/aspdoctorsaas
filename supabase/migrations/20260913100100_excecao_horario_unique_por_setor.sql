-- Libera uma exceção geral + uma por setor na mesma data.
--
-- RODAR SÓ DEPOIS de 20260913100000_excecao_horario_setor_vence_geral.sql:
-- sem a precedência nas funções, a coexistência de linhas na mesma data dá
-- resposta errada (setor aberto continuaria fechado; fn_is_business_hours
-- poderia fechar o tenant inteiro por causa de um setor).
--
-- NULLS NOT DISTINCT (PG15+; produção está no 17.6): sem ele, department_id
-- NULL não colide com NULL e seria possível cadastrar duas gerais na mesma data.
--
-- Arquivo separado de propósito: ALTER TABLE pega ACCESS EXCLUSIVE e esta
-- tabela é lida por segundos_uteis dentro de trg_set_frt_business_seconds
-- (caminho quente de atendimento). Tabela tem ~76 linhas; o lock dura
-- milissegundos, e o lock_timeout garante que ele desiste em vez de enfileirar
-- a operação atrás dele.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.business_hours_exceptions
  DROP CONSTRAINT IF EXISTS business_hours_exceptions_tenant_date_unique;

ALTER TABLE public.business_hours_exceptions
  DROP CONSTRAINT IF EXISTS business_hours_exceptions_tenant_date_dept_unique;

ALTER TABLE public.business_hours_exceptions
  ADD CONSTRAINT business_hours_exceptions_tenant_date_dept_unique
  UNIQUE NULLS NOT DISTINCT (tenant_id, date, department_id);

COMMIT;
