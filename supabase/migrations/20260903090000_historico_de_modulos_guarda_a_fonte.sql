-- ============================================================================
-- O histórico de módulos passa a saber DE ONDE veio a ação, não só de quem.
--
-- `usuario_id` responde "quem" e `origem` responde "de onde veio a LINHA". Nem
-- um nem outro responde "quem mandou fazer ISTO" quando quem mandou foi uma
-- integração:
--
--   · módulo novo pela calculadora  → linha com origem 'intake', usuário nulo
--     → a tela mostra um traço, e ninguém sabe que houve uma venda
--   · quantidade somada pela calculadora num módulo que o espelho criou
--     → linha com origem 'oem', usuário nulo
--     → a tela diria "Sincronização OEM" para uma VENDA. Pior que o traço:
--       afirma algo falso sobre a licença de um cliente.
--
-- `fonte` é a terceira coluna dessa pergunta. Ela não substitui `origem`: a
-- linha continua sendo do espelho: o que mudou é quem pediu a mudança.
--
-- Esta migration só cria a peça. Quem a preenche é o gatilho, na migration
-- seguinte — separadas de propósito: o ALTER pega ACCESS EXCLUSIVE na tabela
-- de eventos, e o gatilho escreve nela a cada mexida em módulo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_acting_source() RETURNS text
LANGUAGE sql STABLE
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT nullif(current_setting('doctorsaas.acting_source', true), '')
$$;

ALTER FUNCTION public.fn_acting_source() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_acting_source() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_acting_source() TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_acting_source() IS
'Quem PEDIU a escrita, quando não foi uma pessoa: "calculadora" para a integração de propostas. Carimbado com set_config(..., true) por quem inicia a transação e lido pelos gatilhos. Companheiro de fn_acting_user(), que responde "quem" e é NULL sob service_role.';

ALTER TABLE public.cliente_produto_modulo_eventos
  ADD COLUMN IF NOT EXISTS fonte text;

COMMENT ON COLUMN public.cliente_produto_modulo_eventos.fonte IS
'De onde veio o PEDIDO desta mexida: "calculadora" (integração de propostas) ou NULL (pessoa na tela, ou carga do espelho — nesse caso quem diz é a coluna origem). Diferente de `origem`, que descreve a linha do módulo, não o evento.';
