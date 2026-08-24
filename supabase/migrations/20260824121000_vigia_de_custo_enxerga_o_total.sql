-- ============================================================================
-- O gatilho e a view passam a enxergar o custo TOTAL
--
-- Ver o arquivo 20260824120000 para o porquê. Aqui vão as duas peças que
-- dependem das colunas novas.
--
-- DUAS GUARDAS QUE NÃO SÃO DETALHE
--
-- 1. Só conta como mudança de preço quando os DOIS lados do total existem.
--    Linha antiga com `vlr_custo_total` nulo que passa a ter valor não é
--    reajuste, é o primeiro preenchimento — e sem essa guarda a próxima carga
--    do espelho geraria uma enxurrada de eventos falsos, justamente na tela
--    que existe para dizer que nada mudou. O caminho inverso (tinha total e
--    veio nulo) é dado faltando no payload, não desconto.
--
-- 2. A ordem dos ramos não muda. Quantidade continua ganhando de preço quando
--    as duas mudam na mesma transação: 2 licenças virando 3 mexe no total por
--    definição, e isso é mudança de quantidade, não de cobrança.
--
-- A view passa a medir a variação pelo TOTAL, caindo no unitário × quantidade
-- só quando não houver total gravado (módulo digitado à mão, evento antigo).
-- Multiplicar onde existe total é o bug de 20/08 de novo.
-- ============================================================================

begin;

-- ------------------------------------------------------ 1. gatilho de log
--
-- Corpo de PRODUÇÃO (dump de 24/08/2026) com três acréscimos: `v_total_ant`,
-- o total no ramo 'preco' e as duas colunas novas no INSERT.
create or replace function public.trg_log_cliente_produto_modulo() returns trigger
    language plpgsql security definer
    set search_path to 'public'
    as $$
DECLARE
  v_acao      text;
  v_row       public.cliente_produto_modulos;
  v_qtd       numeric;
  v_motivo    text;
  v_nome      text;
  v_custo_ant numeric;
  v_total_ant numeric;
  -- Escrita vinda da edge function roda como service_role e nao tem auth.uid():
  -- o historico ficava sem dono e a tela dizia "Sincronização OEM" para uma
  -- acao que uma pessoa mandou fazer. fn_acting_user() devolve quem enfileirou.
  v_uid     uuid := public.fn_acting_user();
  v_usuario text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_acao := 'adicionado'; v_row := NEW; v_qtd := NEW.quantidade;
  ELSIF TG_OP = 'DELETE' THEN
    v_acao := 'removido';   v_row := OLD; v_qtd := OLD.quantidade;
  ELSE
    v_custo_ant := OLD.vlr_custo;
    v_total_ant := OLD.vlr_custo_total;
    IF NEW.cancelado_em IS DISTINCT FROM OLD.cancelado_em AND NEW.cancelado_em IS NOT NULL THEN
      v_acao := 'cancelado';
      v_row := NEW;
      v_motivo := NEW.cancelamento_motivo;
      -- No evento, `quantidade` é QUANTO FOI CANCELADO, não o que sobrou:
      -- "Cancelado · 1" numa linha que tinha 2 é o que a pessoa procura.
      v_qtd := CASE
                 WHEN NEW.ativo = false THEN coalesce(OLD.quantidade, 0)
                 ELSE greatest(coalesce(OLD.quantidade, 0) - coalesce(NEW.quantidade, 0), 0)
               END;
    ELSIF NEW.ativo IS DISTINCT FROM OLD.ativo THEN
      v_acao := CASE WHEN NEW.ativo THEN 'reativado' ELSE 'cancelado' END;
      v_row := NEW; v_qtd := NEW.quantidade; v_motivo := NEW.cancelamento_motivo;
    ELSIF NEW.quantidade IS DISTINCT FROM OLD.quantidade THEN
      v_acao := 'quantidade';
      v_row := NEW;
      -- Mesma régua do cancelamento: o evento diz o que MUDOU. "Quantidade · 1"
      -- numa linha que foi de 2 para 3 é o que a pessoa procura; o total de 3
      -- ela já lê na ficha.
      v_qtd := coalesce(NEW.quantidade, 0) - coalesce(OLD.quantidade, 0);
    ELSIF NEW.vlr_custo IS DISTINCT FROM OLD.vlr_custo
       OR (NEW.vlr_custo_total IS DISTINCT FROM OLD.vlr_custo_total
           AND OLD.vlr_custo_total IS NOT NULL
           AND NEW.vlr_custo_total IS NOT NULL) THEN
      -- O que o parceiro cobra mudou. Pode ser o preço por licença (reajuste)
      -- ou só o total (a cortesia que acabou, o crédito que saiu): os dois
      -- mexem no custo do cliente e os dois têm que aparecer.
      --
      -- `quantidade` aqui é o TOTAL da linha, não um delta: é por ela que a
      -- view multiplica a diferença quando não há custo total gravado.
      v_acao := 'preco';
      v_row := NEW; v_qtd := NEW.quantidade;
    ELSE
      RETURN NULL;
    END IF;
  END IF;

  SELECT m.nome INTO v_nome FROM public.produto_modulos m WHERE m.id = v_row.modulo_id;

  IF v_uid IS NOT NULL THEN
    SELECT f.nome INTO v_usuario
      FROM public.profiles p
      LEFT JOIN public.funcionarios f ON f.id = p.funcionario_id
     WHERE p.user_id = v_uid
     LIMIT 1;
  END IF;

  INSERT INTO public.cliente_produto_modulo_eventos
    (tenant_id, cliente_produto_id, modulo_id, modulo_nome, acao, quantidade,
     vlr_custo, vlr_custo_anterior, vlr_custo_total, vlr_custo_total_anterior,
     vlr_mensal, origem, usuario_id, usuario_nome, motivo)
  VALUES
    (v_row.tenant_id, v_row.cliente_produto_id, v_row.modulo_id,
     coalesce(v_nome, '(módulo sem cadastro)'), v_acao, v_qtd,
     v_row.vlr_custo, v_custo_ant, v_row.vlr_custo_total, v_total_ant,
     v_row.vlr_mensal, coalesce(v_row.origem, 'manual'),
     v_uid, v_usuario, v_motivo);

  RETURN NULL;
END;
$$;

alter function public.trg_log_cliente_produto_modulo() owner to postgres;
grant all on function public.trg_log_cliente_produto_modulo() to authenticated;
grant all on function public.trg_log_cliente_produto_modulo() to service_role;

-- ------------------------------------------------------------- 2. a view
--
-- DROP e CREATE porque as colunas novas entram no meio da lista, e o REPLACE
-- só aceita coluna acrescentada no fim. Só a aba Módulos depende dela.
--
-- `so_total` é o que diz à tela qual par de valores mostrar: quando o preço
-- por licença não mudou, "R$ 32,50 → R$ 32,50" não explicaria nada, e o que a
-- pessoa precisa ver é o total saindo de 0,00.
drop view if exists public.v_oem_mudanca_custo_modulo;

create view public.v_oem_mudanca_custo_modulo
  with (security_invoker = true) as
select
  e.tenant_id,
  cl.unidade_base_id,
  e.modulo_id,
  e.modulo_nome,
  (e.created_at at time zone 'America/Sao_Paulo')::date as dia,
  e.vlr_custo_anterior                                  as valor_anterior,
  e.vlr_custo                                           as valor_novo,
  bool_and(coalesce(e.vlr_custo, 0) = coalesce(e.vlr_custo_anterior, 0))
                                                        as so_total,
  count(*)                                              as clientes,
  sum(coalesce(e.vlr_custo_total_anterior,
               coalesce(e.vlr_custo_anterior, 0) * greatest(coalesce(e.quantidade, 1), 1)))
                                                        as total_anterior,
  sum(coalesce(e.vlr_custo_total,
               coalesce(e.vlr_custo, 0) * greatest(coalesce(e.quantidade, 1), 1)))
                                                        as total_novo,
  -- O que o cliente passou a custar por mês. Total quando o parceiro manda um;
  -- só na falta dele é que multiplica.
  sum(coalesce(e.vlr_custo_total,
               coalesce(e.vlr_custo, 0) * greatest(coalesce(e.quantidade, 1), 1))
      - coalesce(e.vlr_custo_total_anterior,
                 coalesce(e.vlr_custo_anterior, 0) * greatest(coalesce(e.quantidade, 1), 1)))
                                                        as variacao_mensal,
  max(e.created_at)                                     as ocorrido_em
from public.cliente_produto_modulo_eventos e
join public.cliente_produtos cp on cp.id = e.cliente_produto_id
join public.clientes         cl on cl.id = cp.cliente_id
where e.acao = 'preco'
group by 1, 2, 3, 4, 5, 6, 7;

comment on view public.v_oem_mudanca_custo_modulo is
  'Mudanças no que o OEM cobra de licenças que já existem, por módulo, valor, dia e UNIDADE do cliente. Reajuste de tabela não entra aqui: ele não alcança quem já é cliente. A variação sai do custo TOTAL, que é o que o parceiro cobra de fato.';

grant select on public.v_oem_mudanca_custo_modulo to authenticated, service_role;

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura). Continua zero linhas enquanto o OEM não mudar o
-- que cobra de alguém, que é o esperado:
--   select modulo_nome, so_total, valor_anterior, valor_novo,
--          total_anterior, total_novo, clientes, variacao_mensal
--     from public.v_oem_mudanca_custo_modulo order by ocorrido_em desc;
-- ---------------------------------------------------------------------------
