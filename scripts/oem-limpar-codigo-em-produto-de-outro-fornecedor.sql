-- ============================================================================
-- Tira o código de filial do OEM das fichas onde ele está no produto errado
--
-- O CASO (24/08/2026, decisão do Alexandre)
-- 8 clientes da Digi Office — ZOOM ZOOM BAR, CANJA RESTAURANTE e a rede
-- PASTELANDIA — têm o código de uma filial do OEM gravado no produto "Gula",
-- do fornecedor Gula Menu. Gula não é OEM: não há vínculo a manter, e a
-- correção é remover o código, não ignorar o aviso.
--
-- É esse código que fazia o cliente casar com uma filial e entrar na conta da
-- aba do OEM: eram exatamente eles a diferença entre a aba (868 clientes,
-- R$ 328.844) e o Dashboard filtrado por PDV Legal (857, R$ 323.953).
--
-- POR QUE NÃO É "DELETE" E NÃO É A RPC
-- `desvincular_filial_oem` seria o caminho pela tela, mas ela passa por
-- `pode_decidir_oem()`, que exige usuário autenticado — no SQL Editor não há
-- um, e ela levantaria exceção. Aqui o UPDATE é direto, e a reconciliação se
-- refaz sozinha no próximo "Atualizar espelho": ela é apagada e reconstruída a
-- cada carga, e sem o código na ficha esses clientes não casam mais.
--
-- ⚠️ `doctorsaas.skip_valor_sync` NÃO É OPCIONAL. `cliente_produtos` tem
-- gatilho AFTER UPDATE que recalcula `clientes.mensalidade` — ou seja, MRR.
-- Sem a trava, mexer numa coluna de código mexeria no faturamento de 8
-- clientes. É a mesma trava que `oem_gravar_codigos_no_produto` usa.
--
-- EFEITO COLATERAL ESPERADO: as 8 filiais passam a aparecer em "licenças sem
-- cliente no DoctorSaaS". Elas continuam existindo e sendo cobradas pelo OEM —
-- o que muda é que nenhum cadastro daqui diz ser o dono delas.
-- ============================================================================

begin;

select set_config('doctorsaas.skip_valor_sync', 'true', true);

update public.cliente_produtos cp
   set oem_codigo_grupo  = null,
       oem_codigo_filial = null
 where cp.oem_codigo_filial is not null
   -- o produto que carrega o código não é de nenhum produto do OEM vinculado
   -- nesta empresa
   and not exists (
     select 1
       from public.oem_produto_vinculo v
       join public.oem_integration oi on oi.id = v.conta_integration_id
      where oi.tenant_id  = cp.tenant_id
        and v.produto_id  = cp.produto_id
   )
returning cp.cliente_id, cp.produto_id, cp.oem_codigo_filial;

select set_config('doctorsaas.skip_valor_sync', 'false', true);

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (rodar depois, deve voltar 0 linhas):
--
--   select cp.cliente_id, cp.produto_id, cp.oem_codigo_filial
--     from public.cliente_produtos cp
--    where cp.oem_codigo_filial is not null
--      and not exists (
--        select 1 from public.oem_produto_vinculo v
--          join public.oem_integration oi on oi.id = v.conta_integration_id
--         where oi.tenant_id = cp.tenant_id and v.produto_id = cp.produto_id);
--
-- Depois: clicar em Atualizar espelho para a reconciliação ser refeita.
-- ---------------------------------------------------------------------------
