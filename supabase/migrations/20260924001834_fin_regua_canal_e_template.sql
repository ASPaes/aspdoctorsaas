-- =============================================================================
-- Régua de cobrança — por qual número ela sai, e com qual template.
--
-- Decisão do Alexandre em 24/09/2026: a régua da Digi Office sai pelo número
-- OFICIAL da Meta (2108-9933), e o suporte continua nos números Evolution.
--
-- POR QUE ISSO PRECISA SER CONFIGURÁVEL E NÃO UMA CONSTANTE: "API oficial da
-- Meta" não é um número, é um modo, e a migração é exclusiva — número na API
-- oficial para de funcionar no aplicativo e no Evolution. Cada tenant tem uma
-- mistura própria: medido em 24/09/2026, 10 tenants só com Evolution e 3 com os
-- dois modos (ASP, Delvale e Digi Office). A régua tem que se adaptar ao número
-- que envia, não o contrário.
--
-- A DIFERENÇA QUE O MODO FAZ:
--   • Oficial: mensagem iniciada pela empresa fora da janela de 24h só sai como
--     TEMPLATE APROVADO. O texto livre do toque não vale, e mudar o texto passa
--     a depender de aprovação da Meta. Em troca, não há limite de rajada: o
--     limite é de clientes distintos por 24h, em degraus que a Meta sobe
--     sozinha enquanto a qualidade se mantém.
--   • Evolution: texto livre funciona, mas o ritmo tem que imitar gente — uma
--     por vez, intervalo sorteado — sob pena de o número ser banido.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Por qual número a régua sai
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Sem isto, o motor teria que adivinhar entre as instâncias ativas do tenant, e
-- adivinhar qual número cobra os clientes é exatamente o tipo de escolha que
-- não pode ser implícita: manda cobrança pelo número errado e o cliente
-- responde num canal que ninguém lê.
alter table public.configuracoes
  add column if not exists fin_regua_instance_id uuid null
    references public.whatsapp_instances(id) on delete set null;

comment on column public.configuracoes.fin_regua_instance_id is
  'Instância de WhatsApp por onde a régua de cobrança envia. NULL = régua não envia nada, por falta de canal definido. Separar do número de suporte é deliberado: se a cobrança degradar a qualidade do número, o atendimento não cai junto.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Qual template cada toque usa
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Só é exigido quando o canal é oficial. No Evolution continua valendo a
-- `mensagem` em texto livre, que segue sendo a fonte do que se diz — inclusive
-- para conferir na simulação o que o template deveria dizer.
--
-- Guardamos nome + idioma, e não o id da linha em `whatsapp_meta_templates`,
-- porque é assim que a Meta identifica um template no envio. O id local muda a
-- cada sincronização; o par (nome, idioma) é estável.
alter table public.fin_regua_toques
  add column if not exists template_name text null,
  add column if not exists template_language text not null default 'pt_BR';

comment on column public.fin_regua_toques.template_name is
  'Nome do template aprovado na Meta usado quando a régua sai por número oficial. Obrigatório nesse caso: fora da janela de 24h a Meta não entrega texto livre.';
comment on column public.fin_regua_toques.template_language is
  'Idioma do template na Meta (ex.: pt_BR). Junto com o nome, é como a Meta identifica o template no envio.';

-- ⚠️ O rodapé de opt-out precisa estar DENTRO do template quando o canal é
-- oficial: mensagem de template não aceita texto colado no fim. No caminho
-- Evolution o motor acrescenta a linha sozinho. Os dois caminhos têm que
-- oferecer a saída, porque a obrigação é da mensagem, não do canal.
