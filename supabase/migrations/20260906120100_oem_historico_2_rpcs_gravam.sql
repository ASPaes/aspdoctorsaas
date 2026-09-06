-- ============================================================================
-- Trilha do OEM, bloco 2 de 2: as ações da aba passam a gravar o que fizeram.
--
-- Depende do bloco 1 (`oem_alteracao_log`, `fn_oem_log_alteracao`). Aplicar
-- fora de ordem falha na hora da PRIMEIRA execução de cada função, não no
-- CREATE: corpo de plpgsql só resolve nomes ao executar.
--
-- ---------------------------------------------------------------------------
-- NENHUMA ASSINATURA MUDA, E ISSO É DE PROPÓSITO
-- ---------------------------------------------------------------------------
-- A tentação era receber o `lote_id` do navegador para agrupar um clique que
-- faz N chamadas. Custaria DROP + CREATE em cinco funções de produção — e todo
-- DROP leva os GRANTs junto, além de abrir a janela em que a aba Divergências
-- fica sem a função. O `lote_id` nasce DENTRO de cada função:
--
--   - "Aplicar custo" já é uma chamada só para centenas de clientes: continua
--     um lote só, que é o caso que mais importa desfazer inteiro.
--   - O laço de "trazer do parceiro" vira um lote por cliente. Isso é melhor,
--     não pior: dá para devolver um cliente sem devolver os outros 40.
--
-- Todas continuam `CREATE OR REPLACE`: mesma assinatura, mesmos grants, mesmas
-- dependências.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Custos: o custo do OEM vira o custo do produto do cliente.
--
-- O "antes" não sai do RETURNING — ali `cp.vlr_custo` já é o valor novo. Sai de
-- uma CTE irmã, que lê o snapshot anterior à mutação; `feito` devolve os ids
-- que de fato mudaram e o JOIN garante que a trilha só registre esses.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.atualizar_custo_ds_oem(p_tenant_id uuid, p_filiais text[] DEFAULT NULL::text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_res  jsonb;
  v_lote uuid := gen_random_uuid();
begin
  if not public.pode_decidir_oem(p_tenant_id) then
    raise exception 'Sem permissão para atualizar custos do OEM.';
  end if;

  -- Tudo numa consulta só. Sem tabela temporária de propósito: o pooler deste
  -- projeto troca de conexão entre statements, e temp table já mordeu aqui.
  with alvo as (
    -- Quem está vivo dos dois lados e tem vínculo confirmado na ficha.
    select r.filial_codigo,
           r.custo_oem,
           (select count(*) from public.cliente_produtos cp
             where cp.tenant_id = p_tenant_id
               and cp.oem_codigo_filial = r.filial_codigo
               and cp.ativo) as produtos_ativos
      from public.reconciliacao_oem r
     where r.tenant_id = p_tenant_id
       and r.status_oem = 'Ativo'
       and coalesce(r.cancelado_ds, false) = false
       and r.filial_codigo is not null
       and (p_filiais is null or r.filial_codigo = any(p_filiais))
  ),
  -- O retrato de antes. Mesmo WHERE do UPDATE, lido no snapshot anterior.
  antes as (
    select cp.id, cp.cliente_id, cp.vlr_custo as custo_antes,
           a.custo_oem as custo_depois, a.filial_codigo
      from public.cliente_produtos cp
      join alvo a on a.filial_codigo = cp.oem_codigo_filial
     where cp.tenant_id = p_tenant_id
       and cp.ativo
       and a.produtos_ativos = 1
       and coalesce(a.custo_oem, 0) > 0
       and cp.vlr_custo is distinct from a.custo_oem
  ),
  feito as (
    update public.cliente_produtos cp
       set vlr_custo  = a.custo_oem,
           updated_at = now()
      from alvo a
     where cp.tenant_id = p_tenant_id
       and cp.oem_codigo_filial = a.filial_codigo
       and cp.ativo
       and a.produtos_ativos = 1
       and coalesce(a.custo_oem, 0) > 0
       -- Já igual não vira escrita: sem isto, 687 clientes ganhariam
       -- updated_at novo a cada clique e o gatilho rodaria à toa.
       and cp.vlr_custo is distinct from a.custo_oem
    returning cp.id
  ),
  trilha as (
    insert into public.oem_alteracao_log (
      tenant_id, lote_id, acao, cliente_id, cliente_produto_id, filial_codigo,
      cliente_nome, tabela, registro_id, campo, valor_antes, valor_depois,
      reversivel, feito_por)
    select p_tenant_id, v_lote, 'custo', an.cliente_id, an.id, an.filial_codigo,
           coalesce(nullif(btrim(c.nome_fantasia), ''), c.razao_social),
           'cliente_produtos', an.id, 'vlr_custo',
           to_jsonb(an.custo_antes), to_jsonb(an.custo_depois),
           true, public.fn_acting_user()
      from antes an
      join feito f on f.id = an.id
      left join public.clientes c on c.id = an.cliente_id
    returning 1
  )
  -- A contagem continua saindo do UPDATE, não da trilha: se um dia as duas
  -- divergirem, o número que a tela mostra tem de ser o das linhas mudadas.
  -- (`trilha` roda de qualquer jeito — CTE que escreve sempre executa.)
  select jsonb_build_object(
    'atualizados',      (select count(*) from feito),
    'sem_custo_no_oem', (select count(*) from alvo
                          where produtos_ativos = 1 and coalesce(custo_oem, 0) <= 0),
    'ambiguos',         (select count(*) from alvo where produtos_ativos > 1)
  ) into v_res;

  return v_res;
end $function$;

-- ---------------------------------------------------------------------------
-- Divergências: trazer nome ou CNPJ do parceiro para a ficha.
--
-- Esta já calculava `v_antes` e `v_depois` para devolver ao navegador; agora
-- eles também viram trilha. A saída antecipada de "sem mudança" continua antes
-- de qualquer escrita, e não gera linha: nada mudou, não há o que desfazer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.oem_trazer_cadastro_do_parceiro(p_recon_id uuid, p_campo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_l      public.reconciliacao_oem;
  v_antes  text;
  v_depois text;
  v_dono   text;
  v_linhas int;
  v_lote   uuid := gen_random_uuid();
begin
  if p_campo not in ('nome', 'cnpj') then
    raise exception 'Campo inválido: %. Só nome e cnpj.', p_campo;
  end if;

  select * into v_l from public.reconciliacao_oem where id = p_recon_id;
  if v_l.id is null then
    raise exception 'Linha da conferência não encontrada. Atualize o espelho e tente de novo.';
  end if;

  -- Mesma permissão das outras decisões da aba.
  if not public.pode_decidir_oem(v_l.tenant_id) then
    raise exception 'Sem permissão para decidir divergências do OEM.';
  end if;

  if v_l.ds_customer_id is null then
    raise exception 'Esta licença ainda não tem cliente no DoctorSaaS.';
  end if;

  if p_campo = 'nome' then
    -- `razao_oem` é o nome fantasia da loja no OEM, e é ele que a conferência
    -- compara com `clientes.nome_fantasia`. Gravar em razao_social resolveria
    -- outra divergência que não é esta.
    if coalesce(btrim(v_l.razao_oem), '') = '' then
      raise exception 'O OEM não tem nome para esta licença.';
    end if;
    v_depois := btrim(v_l.razao_oem);

    select nome_fantasia into v_antes from public.clientes where id = v_l.ds_customer_id;
    if v_antes is not distinct from v_depois then
      return jsonb_build_object('campo', p_campo, 'sem_mudanca', true, 'valor', v_depois);
    end if;

    update public.clientes
       set nome_fantasia = v_depois, updated_at = now()
     where id = v_l.ds_customer_id;

    -- A fotografia acompanha, senão a linha fica na tela dizendo o valor velho.
    update public.reconciliacao_oem r
       set razao_ds     = v_depois,
           divergencias = nullif(array_remove(coalesce(r.divergencias, '{}'::text[]), 'nome'), '{}'::text[])
     where r.tenant_id      = v_l.tenant_id
       and r.ds_customer_id = v_l.ds_customer_id;
    get diagnostics v_linhas = row_count;

    perform public.fn_oem_log_alteracao(
      p_tenant_id            => v_l.tenant_id,
      p_lote_id              => v_lote,
      p_acao                 => 'nome',
      p_cliente_id           => v_l.ds_customer_id,
      p_tabela               => 'clientes',
      p_registro_id          => v_l.ds_customer_id,
      p_campo                => 'nome_fantasia',
      p_valor_antes          => to_jsonb(v_antes),
      p_valor_depois         => to_jsonb(v_depois),
      p_recon_id             => p_recon_id,
      p_filial_codigo        => v_l.filial_codigo,
      p_conta_integration_id => v_l.conta_integration_id);

  else
    if coalesce(btrim(v_l.cnpj_norm), '') = '' then
      raise exception 'O OEM não tem CNPJ para esta licença.';
    end if;
    v_depois := regexp_replace(v_l.cnpj_norm, '[^0-9]', '', 'g');

    -- A guarda. Vem ANTES de qualquer escrita.
    select coalesce(nullif(btrim(c.nome_fantasia), ''), c.razao_social)
      into v_dono
      from public.clientes c
     where c.tenant_id = v_l.tenant_id
       and c.id <> v_l.ds_customer_id
       and c.cnpj_digits = v_depois
     limit 1;
    if v_dono is not null then
      raise exception 'O CNPJ % já é do cliente "%". Se a licença é dele, use Trocar cliente.',
        v_depois, v_dono;
    end if;

    select cnpj into v_antes from public.clientes where id = v_l.ds_customer_id;
    if regexp_replace(coalesce(v_antes, ''), '[^0-9]', '', 'g') = v_depois then
      return jsonb_build_object('campo', p_campo, 'sem_mudanca', true, 'valor', v_depois);
    end if;

    update public.clientes
       set cnpj = v_depois, updated_at = now()
     where id = v_l.ds_customer_id;

    -- Só o lado do DoctorSaaS. `cnpj_norm` é o documento do parceiro e é chave
    -- de match em meia dúzia de consultas: reescrevê-lo daqui trocaria a
    -- identidade da linha, não corrigiria uma divergência.
    update public.reconciliacao_oem r
       set cnpj_ds      = v_depois,
           divergencias = nullif(array_remove(coalesce(r.divergencias, '{}'::text[]), 'cnpj'), '{}'::text[])
     where r.tenant_id      = v_l.tenant_id
       and r.ds_customer_id = v_l.ds_customer_id;
    get diagnostics v_linhas = row_count;

    perform public.fn_oem_log_alteracao(
      p_tenant_id            => v_l.tenant_id,
      p_lote_id              => v_lote,
      p_acao                 => 'cnpj',
      p_cliente_id           => v_l.ds_customer_id,
      p_tabela               => 'clientes',
      p_registro_id          => v_l.ds_customer_id,
      p_campo                => 'cnpj',
      p_valor_antes          => to_jsonb(v_antes),
      p_valor_depois         => to_jsonb(v_depois),
      p_recon_id             => p_recon_id,
      p_filial_codigo        => v_l.filial_codigo,
      p_conta_integration_id => v_l.conta_integration_id);
  end if;

  return jsonb_build_object(
    'campo',        p_campo,
    'cliente_id',   v_l.ds_customer_id,
    'antes',        v_antes,
    'depois',       v_depois,
    'linhas_espelho', v_linhas,
    'sem_mudanca',  false
  );
end $function$;

-- ---------------------------------------------------------------------------
-- Vincular uma licença a um cliente.
--
-- O "antes" que interessa é DE QUEM a licença era. Sem ele, desfazer só saberia
-- desvincular, e a licença que tinha sido tirada de outro cliente não voltaria
-- para ele.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vincular_filial_oem(p_recon_id uuid, p_cliente_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare v_tenant uuid; v_cli record; v_rec record; v_res int;
        v_dono_antes uuid; v_nome_antes text;
begin
  select tenant_id, empresa_codigo, filial_codigo, conta_integration_id, ds_customer_id
    into v_rec
    from public.reconciliacao_oem where id = p_recon_id;
  if v_rec is null then raise exception 'Linha de conciliação não encontrada.'; end if;
  v_tenant := v_rec.tenant_id;
  if not public.pode_decidir_oem(v_tenant) then
    raise exception 'Sem permissão para decidir vínculos do OEM.';
  end if;

  select id, coalesce(nome_fantasia, razao_social) as nome, mensalidade, cancelado
    into v_cli
    from public.clientes
   where id = p_cliente_id and tenant_id = v_tenant;
  if not found then raise exception 'Cliente não pertence a esta empresa.'; end if;

  v_dono_antes := v_rec.ds_customer_id;
  if v_dono_antes is not null then
    select coalesce(nullif(btrim(nome_fantasia), ''), razao_social)
      into v_nome_antes from public.clientes where id = v_dono_antes;
  end if;

  -- Se esta licença estava em outro cliente, o código sai de lá antes de entrar
  -- aqui — senão dois cadastros diriam ser a mesma filial.
  perform public.oem_gravar_codigos_no_produto(r.ds_customer_id, null, null)
     from public.reconciliacao_oem r
    where r.id = p_recon_id and r.ds_customer_id is not null
      and r.ds_customer_id <> p_cliente_id;

  v_res := 0;
  if v_rec.filial_codigo is not null then
    v_res := public.oem_gravar_codigos_no_produto(
      p_cliente_id, v_rec.empresa_codigo, v_rec.filial_codigo);
  end if;

  update public.reconciliacao_oem
     set ds_customer_id      = v_cli.id,
         candidato_escolhido = v_cli.id,
         razao_ds            = v_cli.nome,
         mensalidade_ds      = v_cli.mensalidade,
         cancelado_ds        = v_cli.cancelado,
         estado_match        = case when filial_codigo is null then estado_match else 'CASADO' end,
         status_usuario      = 'vinculado',
         observacao          = case v_res
                                 when -1 then 'Cliente tem mais de um produto ativo — código do OEM não foi gravado em nenhum.'
                                 when  0 then 'Cliente não tem produto ativo — código do OEM não foi gravado.'
                                 else null end,
         resolvido_em        = now(),
         resolvido_por       = auth.uid()
   where id = p_recon_id;

  -- O cliente acabou de ganhar licença: a linha que dizia "só no DS" virou
  -- mentira. Some agora em vez de esperar a próxima carga. Só sai a linha SEM
  -- filial: as com filial são licenças e nenhuma delas é retrato descartável.
  if v_rec.filial_codigo is not null then
    delete from public.reconciliacao_oem
     where tenant_id            = v_tenant
       and conta_integration_id = v_rec.conta_integration_id
       and ds_customer_id       = p_cliente_id
       and filial_codigo is null;
  end if;

  perform public.fn_oem_log_alteracao(
    p_tenant_id            => v_tenant,
    p_lote_id              => gen_random_uuid(),
    p_acao                 => 'vinculo',
    p_cliente_id           => p_cliente_id,
    p_tabela               => 'reconciliacao_oem',
    p_registro_id          => p_recon_id,
    p_campo                => 'ds_customer_id',
    p_valor_antes          => jsonb_build_object('cliente_id', v_dono_antes, 'cliente_nome', v_nome_antes),
    p_valor_depois         => jsonb_build_object('cliente_id', p_cliente_id, 'cliente_nome', v_cli.nome),
    p_recon_id             => p_recon_id,
    p_filial_codigo        => v_rec.filial_codigo,
    p_conta_integration_id => v_rec.conta_integration_id);
end $function$;

-- ---------------------------------------------------------------------------
-- Desvincular. O "antes" é o cliente que perdeu a licença.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.desvincular_filial_oem(p_recon_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare v_tenant uuid; v_cliente uuid; v_rec record;
begin
  select tenant_id, ds_customer_id, filial_codigo, conta_integration_id
    into v_rec
    from public.reconciliacao_oem where id = p_recon_id;
  v_tenant := v_rec.tenant_id;
  v_cliente := v_rec.ds_customer_id;
  if v_tenant is null then raise exception 'Linha de conciliação não encontrada.'; end if;
  if not public.pode_decidir_oem(v_tenant) then
    raise exception 'Sem permissão para decidir vínculos do OEM.';
  end if;

  if v_cliente is not null then
    perform public.oem_gravar_codigos_no_produto(v_cliente, null, null);
  end if;

  update public.reconciliacao_oem
     set ds_customer_id      = null,
         candidato_escolhido = null,
         razao_ds            = null,
         mensalidade_ds      = null,
         cancelado_ds        = null,
         estado_match        = case when filial_codigo is null then estado_match
                                    when qtd_candidatos_ds > 1 then 'AMBIGUO'
                                    when qtd_candidatos_ds = 0 then 'SO_NO_OEM'
                                    else estado_match end,
         status_usuario      = 'novo',
         observacao          = null,
         resolvido_em        = null,
         resolvido_por       = null
   where id = p_recon_id;

  -- Sem cliente antes não houve desvínculo nenhum: a linha já estava solta.
  -- Registrar seria encher a trilha de nada.
  if v_cliente is not null then
    perform public.fn_oem_log_alteracao(
      p_tenant_id            => v_tenant,
      p_lote_id              => gen_random_uuid(),
      p_acao                 => 'desvinculo',
      p_cliente_id           => v_cliente,
      p_tabela               => 'reconciliacao_oem',
      p_registro_id          => p_recon_id,
      p_campo                => 'ds_customer_id',
      p_valor_antes          => jsonb_build_object('cliente_id', v_cliente),
      p_valor_depois         => NULL,
      p_recon_id             => p_recon_id,
      p_filial_codigo        => v_rec.filial_codigo,
      p_conta_integration_id => v_rec.conta_integration_id);
  end if;
end $function$;

-- ---------------------------------------------------------------------------
-- Tirar o código da filial da ficha do cliente.
--
-- Os códigos são lidos ANTES de sumirem: são eles que permitem devolver. Se não
-- havia código nenhum, nada aconteceu e nada é registrado.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.oem_remover_codigo_filial(p_cliente_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_antes  record;
  v_res    integer;
begin
  select tenant_id into v_tenant
    from public.clientes where id = p_cliente_id;
  if v_tenant is null then
    raise exception 'Cliente não encontrado.';
  end if;
  if not public.pode_decidir_oem(v_tenant) then
    raise exception 'Sem permissão para decidir vínculos do OEM.';
  end if;

  select id, oem_codigo_grupo, oem_codigo_filial
    into v_antes
    from public.cliente_produtos
   where cliente_id = p_cliente_id
     and oem_codigo_filial is not null
   limit 1;

  -- Limpa o código de TODAS as linhas de produto do cliente: é o mesmo
  -- comportamento do Desfazer da fila, e o cliente que chega aqui tem o número
  -- num produto só.
  v_res := public.oem_gravar_codigos_no_produto(p_cliente_id, null, null);

  if v_antes.id is not null then
    perform public.fn_oem_log_alteracao(
      p_tenant_id          => v_tenant,
      p_lote_id            => gen_random_uuid(),
      p_acao               => 'codigo_filial',
      p_cliente_id         => p_cliente_id,
      p_tabela             => 'cliente_produtos',
      p_registro_id        => v_antes.id,
      p_campo              => 'oem_codigo_filial',
      p_valor_antes        => jsonb_build_object('grupo', v_antes.oem_codigo_grupo,
                                                 'filial', v_antes.oem_codigo_filial),
      p_valor_depois       => NULL,
      p_cliente_produto_id => v_antes.id,
      p_filial_codigo      => v_antes.oem_codigo_filial);
  end if;

  return v_res;
end $function$;

-- ---------------------------------------------------------------------------
-- Marcar divergência como certa, e trazer de volta.
--
-- Não mudam cadastro, mudam o que a aba mostra. Entram na trilha porque são
-- decisão de gente sobre o vínculo — e são reversíveis uma pela outra, então o
-- botão Desfazer funciona nelas de graça.
--
-- A ASSINATURA vai no `valor_antes` do "ignorar": é ela que diz o que estava
-- sendo comparado quando a pessoa decidiu, e sem ela o desfazer do "reexibir"
-- não conseguiria remarcar do mesmo jeito.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.oem_ignorar_divergencia(p_tipo text, p_assinatura text, p_recon_id uuid DEFAULT NULL::uuid, p_cliente_id uuid DEFAULT NULL::uuid, p_conta uuid DEFAULT NULL::uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_tenant  uuid;
  v_n       int;
  v_cliente uuid;
  v_filial  text;
  v_conta   uuid;
begin
  if p_tipo is null or btrim(p_tipo) = '' then
    raise exception 'Informe o tipo da divergência.';
  end if;
  if p_recon_id is null and (p_cliente_id is null or p_conta is null) then
    raise exception 'Informe a linha, ou o cliente e a conta.';
  end if;

  if p_recon_id is not null then
    select tenant_id, ds_customer_id, filial_codigo, conta_integration_id
      into v_tenant, v_cliente, v_filial, v_conta
      from public.reconciliacao_oem where id = p_recon_id;
  else
    select tenant_id, ds_customer_id, filial_codigo, conta_integration_id
      into v_tenant, v_cliente, v_filial, v_conta
      from public.reconciliacao_oem
     where conta_integration_id = p_conta and ds_customer_id = p_cliente_id
     limit 1;
  end if;

  if v_tenant is null then
    raise exception 'Linha de conciliação não encontrada.';
  end if;
  -- Mesmo portão de vincular/desvincular: ignorar é decisão sobre o vínculo.
  if not public.pode_decidir_oem(v_tenant) then
    raise exception 'Sem permissão para decidir vínculos do OEM.';
  end if;

  update public.reconciliacao_oem
     set ignoradas = coalesce(ignoradas, '{}'::jsonb)
                     || jsonb_build_object(p_tipo, coalesce(nullif(btrim(p_assinatura), ''), p_tipo))
   where (p_recon_id is not null and id = p_recon_id)
      or (p_recon_id is null
          and conta_integration_id = p_conta
          and ds_customer_id = p_cliente_id);

  get diagnostics v_n = row_count;

  if v_n > 0 then
    perform public.fn_oem_log_alteracao(
      p_tenant_id            => v_tenant,
      p_lote_id              => gen_random_uuid(),
      p_acao                 => 'ignorar_divergencia',
      p_cliente_id           => coalesce(p_cliente_id, v_cliente),
      p_tabela               => 'reconciliacao_oem',
      p_registro_id          => p_recon_id,
      p_campo                => p_tipo,
      p_valor_antes          => jsonb_build_object(
                                  'assinatura', coalesce(nullif(btrim(p_assinatura), ''), p_tipo),
                                  'cliente_id', p_cliente_id,
                                  'conta',      p_conta),
      p_valor_depois         => to_jsonb(v_n),
      p_recon_id             => p_recon_id,
      p_filial_codigo        => v_filial,
      p_conta_integration_id => coalesce(p_conta, v_conta));
  end if;

  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION public.oem_reexibir_divergencia(p_tipo text, p_recon_id uuid DEFAULT NULL::uuid, p_cliente_id uuid DEFAULT NULL::uuid, p_conta uuid DEFAULT NULL::uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_tenant     uuid;
  v_n          int;
  v_cliente    uuid;
  v_filial     text;
  v_conta      uuid;
  v_assinatura text;
begin
  if p_tipo is null or btrim(p_tipo) = '' then
    raise exception 'Informe o tipo da divergência.';
  end if;
  if p_recon_id is null and (p_cliente_id is null or p_conta is null) then
    raise exception 'Informe a linha, ou o cliente e a conta.';
  end if;

  if p_recon_id is not null then
    select tenant_id, ds_customer_id, filial_codigo, conta_integration_id, ignoradas->>p_tipo
      into v_tenant, v_cliente, v_filial, v_conta, v_assinatura
      from public.reconciliacao_oem where id = p_recon_id;
  else
    select tenant_id, ds_customer_id, filial_codigo, conta_integration_id, ignoradas->>p_tipo
      into v_tenant, v_cliente, v_filial, v_conta, v_assinatura
      from public.reconciliacao_oem
     where conta_integration_id = p_conta and ds_customer_id = p_cliente_id
     limit 1;
  end if;

  if v_tenant is null then
    raise exception 'Linha de conciliação não encontrada.';
  end if;
  if not public.pode_decidir_oem(v_tenant) then
    raise exception 'Sem permissão para decidir vínculos do OEM.';
  end if;

  update public.reconciliacao_oem
     set ignoradas = nullif(coalesce(ignoradas, '{}'::jsonb) - p_tipo, '{}'::jsonb)
   where (p_recon_id is not null and id = p_recon_id)
      or (p_recon_id is null
          and conta_integration_id = p_conta
          and ds_customer_id = p_cliente_id);

  get diagnostics v_n = row_count;

  if v_n > 0 then
    perform public.fn_oem_log_alteracao(
      p_tenant_id            => v_tenant,
      p_lote_id              => gen_random_uuid(),
      p_acao                 => 'reexibir_divergencia',
      p_cliente_id           => coalesce(p_cliente_id, v_cliente),
      p_tabela               => 'reconciliacao_oem',
      p_registro_id          => p_recon_id,
      p_campo                => p_tipo,
      -- A assinatura lida ANTES do UPDATE: é o que o desfazer precisa para
      -- remarcar exatamente o que estava marcado.
      p_valor_antes          => jsonb_build_object(
                                  'assinatura', v_assinatura,
                                  'cliente_id', p_cliente_id,
                                  'conta',      p_conta),
      p_valor_depois         => to_jsonb(v_n),
      p_recon_id             => p_recon_id,
      p_filial_codigo        => v_filial,
      p_conta_integration_id => coalesce(p_conta, v_conta));
  end if;

  return v_n;
end $function$;

-- ---------------------------------------------------------------------------
-- Conexão: salvar a chave.
--
-- Fica registrado QUE alguém trocou a credencial, e nada além disso. O valor
-- guardado é o mesmo prefixo que a própria tela já mostra; a chave mora no
-- Vault e não passa por aqui. Sem desfazer: a anterior não existe mais.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.salvar_chave_oem(p_tenant_id uuid, p_unidades bigint[], p_chave text, p_api_url text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare v_id uuid; v_sid uuid; v_nome text; v_novo boolean;
begin
  if not public.pode_decidir_oem(p_tenant_id) then
    raise exception 'Apenas administradores podem configurar a integração OEM.';
  end if;
  if coalesce(trim(p_chave), '') = '' then
    raise exception 'Chave vazia.';
  end if;

  -- Uma unidade não pode estar em duas contas: o espelho ficaria ambíguo.
  select id into v_id from public.oem_integration
   where tenant_id = p_tenant_id and unidades_base_ids && p_unidades limit 1;
  v_novo := v_id is null;

  v_nome := 'oem_api_key_' || p_tenant_id::text || '_' || coalesce(p_unidades[1], 0)::text;
  begin
    v_sid := public.vault_get_secret_id_by_name(v_nome);
  exception when others then v_sid := null;
  end;
  if v_sid is null then
    v_sid := public.vault_create_secret(trim(p_chave), v_nome);
  else
    perform public.vault_update_secret(v_sid, trim(p_chave));
  end if;

  if v_id is null then
    insert into public.oem_integration
      (tenant_id, unidades_base_ids, vault_secret_id, chave_prefixo, api_url, criado_por)
    values (p_tenant_id, p_unidades, v_sid, left(trim(p_chave), 17),
            coalesce(p_api_url, 'https://furohpfhukwajhvnnbiw.functions.supabase.co'), auth.uid())
    returning id into v_id;
  else
    update public.oem_integration
       set unidades_base_ids = p_unidades,
           vault_secret_id   = v_sid,
           chave_prefixo     = left(trim(p_chave), 17),
           api_url           = coalesce(p_api_url, api_url),
           ultimo_status     = 'nao_testado'
     where id = v_id;
  end if;

  perform public.fn_oem_log_alteracao(
    p_tenant_id            => p_tenant_id,
    p_lote_id              => gen_random_uuid(),
    p_acao                 => 'chave',
    p_tabela               => 'oem_integration',
    p_registro_id          => v_id,
    p_campo                => case when v_novo then 'conta_criada' else 'chave_trocada' end,
    p_valor_depois         => jsonb_build_object('prefixo', left(trim(p_chave), 17)),
    p_conta_integration_id => v_id,
    p_reversivel           => false);

  return v_id;
end $function$;

COMMIT;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura), depois de aplicar:
--   select p.oid::regprocedure::text, p.proacl::text
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('atualizar_custo_ds_oem','oem_trazer_cadastro_do_parceiro',
--                        'vincular_filial_oem','desvincular_filial_oem',
--                        'oem_remover_codigo_filial','oem_ignorar_divergencia',
--                        'oem_reexibir_divergencia','salvar_chave_oem')
--    order by 1;
--   -- 8 linhas, uma assinatura cada. Duas assinaturas do mesmo nome = sobrecarga
--   -- acidental, e o PostgREST passa a recusar a chamada por ambiguidade.
-- ---------------------------------------------------------------------------
