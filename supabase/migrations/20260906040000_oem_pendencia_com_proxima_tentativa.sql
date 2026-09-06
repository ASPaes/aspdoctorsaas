-- A ficha do cliente precisa dizer QUANDO vai tentar de novo.
--
-- POR QUE
-- Em 04/09/2026, na CONFRARIA DO CAFE GOURMET, uma ativação de módulo falhou
-- quatro vezes seguidas (HTTP 500 vindo da nossa própria função, não do
-- parceiro). A fila reagendou sozinha em 2, 5, 15 e 60 minutos e a quinta
-- tentativa funcionou — mas a ficha, nesse meio tempo, só dizia "OEM recusou —
-- na fila". Duas coisas erradas na mesma frase: o OEM não recusou nada, e não
-- havia como saber que ainda estava tentando. A operadora concluiu que tinha
-- falhado e cadastrou o módulo à mão no portal do parceiro.
--
-- Silêncio de uma hora e meia é o que produz trabalho manual. A fila já sabia
-- a hora da próxima tentativa; ela só não chegava até a tela.
--
-- Três campos a mais, nada além disso: mesma permissão, mesmos filtros.
create or replace function public.fn_oem_pendencias_do_cliente(p_cliente_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.clientes WHERE id = p_cliente_id;
  -- O coalesce fica POR FORA da expressão inteira: com os dois lados NULL
  -- (sessão sem perfil), `NOT NULL` é NULL, o IF não dispara e o portão
  -- liberaria justamente para quem não tem tenant.
  IF NOT coalesce(
       v_tenant = public.current_tenant_id() OR coalesce(public.is_super_admin(), false),
       false) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'fila_id',            f.id,
             'cliente_produto_id', f.cliente_produto_id,
             'modulo_linha_id',    f.modulo_linha_id,
             'modulo_catalogo_id', f.modulo_catalogo_id,
             'modulo',             pm.nome,
             'acao',               f.acao,
             'quantidade',         f.quantidade,
             'status',             f.status,
             'ultimo_erro',        f.ultimo_erro,
             'motivo_recusa',      f.motivo_recusa,
             'decidido_em',        f.decidido_em,
             'enfileirado_em',     f.enfileirado_em,
             -- Os três novos.
             -- `proxima_tentativa_em` é o que transforma "falhou" em "está
             -- tentando de novo às 15:22", que é a diferença entre esperar e
             -- refazer no portal do parceiro.
             'proxima_tentativa_em', f.proxima_tentativa_em,
             'tentativas',           f.tentativas,
             -- O status HTTP separa "o parceiro recusou" (4xx, e aí repetir
             -- não resolve) de "a chamada quebrou" (5xx ou nenhum, e aí a
             -- retentativa costuma resolver sozinha). Chamar as duas de
             -- "OEM recusou" põe a culpa no parceiro e sugere ação manual.
             'http',                 f.http))
      FROM public.oem_sync_fila f
      JOIN public.cliente_produtos cp ON cp.id = f.cliente_produto_id
      LEFT JOIN public.produto_modulos pm ON pm.id = f.modulo_catalogo_id
     WHERE cp.cliente_id = p_cliente_id
       AND (
         f.status IN ('aguardando_aprovacao','pendente','processando','erro','invalido')
         OR (f.status = 'recusado' AND f.decidido_em > now() - interval '7 days')
       )
  ), '[]'::jsonb);
END;
$function$;
