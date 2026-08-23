-- ============================================================================
-- Quando o OEM muda o preço de um módulo: ajustar todo mundo (já acontecia) e
-- DEIXAR RASTRO (é o que faltava)
--
-- O QUE JÁ FUNCIONAVA, e por isso não se mexe aqui
-- A cada carga do espelho (6h), `fn_oem_espelhar_modulos_no_contrato` reescreve
-- o `vlr_custo` de todo módulo de cliente com `origem = 'oem'` usando o valor
-- que o OEM cobra DAQUELA FILIAL. Medido em 23/08/2026: 4.052 das 4.060 linhas
-- de módulo de cliente são de origem OEM, então o reajuste já chega em todos
-- sozinho. Módulo digitado à mão (7 linhas) nunca é tocado, de propósito.
--
-- O valor vem por filial, e não da tabela de preços do parceiro, porque o OEM
-- dá unidade grátis e desconto por cliente: aplicar o preço de tabela em todo
-- mundo inventaria número. Ver `oem-valor-total-nunca-multiplicar`.
--
-- O QUE FALTAVA: NINGUÉM FICAVA SABENDO
-- `trg_log_cliente_produto_modulo` registra adicionado/removido/cancelado/
-- reativado/quantidade e devolve NULL para todo o resto — mudança de preço caía
-- exatamente nesse "resto". O custo do cliente mudava em silêncio, e o único
-- histórico que existia (`oem_preco_modulo_historico`) é da tabela de preços do
-- parceiro, não do que cada cliente paga.
--
-- Três coisas entram aqui:
--   1. `vlr_custo_anterior` no evento, porque "passou de X para Y" precisa dos
--      dois lados. A tabela só guardava o valor depois.
--   2. A ação 'preco' no gatilho de log, para a mudança virar evento na mesma
--      linha do tempo do módulo que a ficha do cliente já mostra.
--   3. A view que a aba Módulos vai ler: uma linha por (módulo, de → para, dia),
--      com quantos clientes pegaram o ajuste e quanto mexeu no custo por mês.
--
-- E o catálogo passa a acompanhar a tabela do parceiro: até hoje
-- `produto_modulos.vlr_custo` só mudava quando alguém clicava em atualizar o
-- vínculo do produto.
--
-- VENDA NÃO SE MEXE. Decisão do Alexandre em 23/08/2026: isto é tudo CUSTO. O
-- `vlr_mensal` (o que o cliente paga) é MRR — repassar aumento é decisão de
-- gente, não de gatilho. A tela mostra o aumento; o repasse continua manual.
-- ============================================================================

begin;

-- ------------------------------------------------------------------ 1. coluna
alter table public.cliente_produto_modulo_eventos
  add column if not exists vlr_custo_anterior numeric;

comment on column public.cliente_produto_modulo_eventos.vlr_custo_anterior is
  'Custo do módulo ANTES do evento. Preenchido em todo UPDATE; com vlr_custo forma o par "de X para Y" que a ação preco mostra.';

-- --------------------------------------------------- 2. gatilho de log do módulo
--
-- Corpo de PRODUÇÃO (dump de 23/08/2026) com dois acréscimos: `v_custo_ant`,
-- preenchido em todo UPDATE, e o ramo 'preco'. A ordem dos ramos é a régua do
-- que importa mais: cancelamento e quantidade continuam ganhando de preço
-- quando mudam na mesma transação — mas, mesmo aí, o evento agora carrega o
-- custo anterior, então nada se perde.
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
    ELSIF NEW.vlr_custo IS DISTINCT FROM OLD.vlr_custo THEN
      -- O reajuste do parceiro. `quantidade` aqui é o TOTAL da linha, não um
      -- delta: é por ela que a view multiplica a diferença para dizer quanto o
      -- aumento pesa por mês naquele cliente.
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
     vlr_custo, vlr_custo_anterior, vlr_mensal, origem, usuario_id, usuario_nome, motivo)
  VALUES
    (v_row.tenant_id, v_row.cliente_produto_id, v_row.modulo_id,
     coalesce(v_nome, '(módulo sem cadastro)'), v_acao, v_qtd,
     v_row.vlr_custo, v_custo_ant, v_row.vlr_mensal, coalesce(v_row.origem, 'manual'),
     v_uid, v_usuario, v_motivo);

  RETURN NULL;
END;
$$;

alter function public.trg_log_cliente_produto_modulo() owner to postgres;
grant all on function public.trg_log_cliente_produto_modulo() to authenticated;
grant all on function public.trg_log_cliente_produto_modulo() to service_role;

-- ------------------------------------------------------- 3. o que a aba lê
--
-- Um reajuste do parceiro vira N eventos, um por cliente (o módulo "Licença
-- PDV" sozinho está em 767). A tela não quer 767 linhas: quer "Licença PDV
-- passou de R$ 10,13 para R$ 11,00 em 767 clientes, +R$ 667/mês".
--
-- Agrupa por DIA porque a carga é de 6 em 6 horas e o parceiro não muda preço
-- de um cliente só: o reajuste chega em lote, e o dia é o grão em que ele é
-- reconhecível.
--
-- security_invoker: a view respeita o RLS de quem consulta, em vez de rodar
-- como dona e mostrar evento de outro tenant.
create or replace view public.v_oem_mudanca_custo_modulo
  with (security_invoker = true) as
select
  e.tenant_id,
  e.modulo_id,
  e.modulo_nome,
  (e.created_at at time zone 'America/Sao_Paulo')::date as dia,
  e.vlr_custo_anterior                                  as valor_anterior,
  e.vlr_custo                                           as valor_novo,
  count(*)                                              as clientes,
  -- O que o aumento pesa por mês: a diferença vale por unidade, e o cliente
  -- pode ter 8 licenças do mesmo módulo.
  sum((coalesce(e.vlr_custo, 0) - coalesce(e.vlr_custo_anterior, 0))
      * greatest(coalesce(e.quantidade, 1), 1))         as variacao_mensal,
  max(e.created_at)                                     as ocorrido_em
from public.cliente_produto_modulo_eventos e
where e.acao = 'preco'
group by 1, 2, 3, 4, 5, 6;

comment on view public.v_oem_mudanca_custo_modulo is
  'Reajustes de custo que o OEM aplicou, agrupados por módulo, valor e dia. Uma linha aqui = um preço que o parceiro mexeu, com quantos clientes pegaram.';

grant select on public.v_oem_mudanca_custo_modulo to authenticated, service_role;

-- ------------------------------------- 4. catálogo acompanha o preço de tabela
--
-- Mesma função de sempre (corpo de produção de 23/08/2026), com um acréscimo no
-- ramo do UPDATE: além de registrar, ela leva o valor novo para o
-- `produto_modulos.vlr_custo` dos produtos vinculados àquele produto do OEM.
--
-- Por que é seguro: `produto_modulos` não tem gatilho nenhum (conferido no
-- schema de produção) — é catálogo, não contrato. Nada vai para o Omie, nada
-- mexe em MRR. E `vlr_venda` continua intocado: só o custo acompanha o parceiro.
--
-- Casa por `oem_modulo_codigo` quando ele existe (191 dos 614 módulos) e, para
-- os antigos que não têm o código, cai no nome normalizado — a mesma régua que
-- `fn_oem_vincular_produto` já usa.
create or replace function public.fn_oem_registrar_mudanca_preco() returns trigger
    language plpgsql security definer
    set search_path to 'public'
    as $$
begin
  if tg_op = 'INSERT' then
    insert into public.oem_preco_modulo_historico (
      tenant_id, conta_integration_id, produto_codigo, produto_nome,
      modulo_codigo, modulo_nome, evento, valor_anterior, valor_novo)
    values (
      new.tenant_id, new.conta_integration_id, new.produto_codigo, new.produto_nome,
      new.modulo_codigo, new.modulo_nome, 'entrou', null, new.valor_unitario);
    return new;

  elsif tg_op = 'UPDATE' then
    -- `is distinct from` e não `<>`: com NULL de um dos lados o `<>` devolve
    -- NULL, o if não dispara e a mudança passaria batida.
    if new.valor_unitario is distinct from old.valor_unitario then
      insert into public.oem_preco_modulo_historico (
        tenant_id, conta_integration_id, produto_codigo, produto_nome,
        modulo_codigo, modulo_nome, evento, valor_anterior, valor_novo)
      values (
        new.tenant_id, new.conta_integration_id, new.produto_codigo, new.produto_nome,
        new.modulo_codigo, new.modulo_nome, 'alterou', old.valor_unitario, new.valor_unitario);

      update public.produto_modulos m
         set vlr_custo  = new.valor_unitario,
             updated_at = now()
        from public.oem_produto_vinculo v
       where v.conta_integration_id = new.conta_integration_id
         and v.produto_codigo       = new.produto_codigo
         and m.produto_id           = v.produto_id
         and m.tenant_id            = new.tenant_id
         and (
           m.oem_modulo_codigo = new.modulo_codigo
           or (m.oem_modulo_codigo is null
               and public.fn_norm_nome_modulo(m.nome)
                   = public.fn_norm_nome_modulo(new.modulo_nome))
         )
         and m.vlr_custo is distinct from new.valor_unitario;
    end if;
    return new;

  else
    insert into public.oem_preco_modulo_historico (
      tenant_id, conta_integration_id, produto_codigo, produto_nome,
      modulo_codigo, modulo_nome, evento, valor_anterior, valor_novo)
    values (
      old.tenant_id, old.conta_integration_id, old.produto_codigo, old.produto_nome,
      old.modulo_codigo, old.modulo_nome, 'saiu', old.valor_unitario, null);
    return old;
  end if;
end;
$$;

alter function public.fn_oem_registrar_mudanca_preco() owner to postgres;
grant all on function public.fn_oem_registrar_mudanca_preco() to authenticated;
grant all on function public.fn_oem_registrar_mudanca_preco() to service_role;

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura). Antes do primeiro reajuste do parceiro as duas
-- devolvem zero linhas — é o esperado, não falha:
--
--   select * from public.v_oem_mudanca_custo_modulo order by ocorrido_em desc;
--
--   select acao, count(*) from public.cliente_produto_modulo_eventos
--    where created_at > now() - interval '7 days' group by 1;
-- ---------------------------------------------------------------------------
