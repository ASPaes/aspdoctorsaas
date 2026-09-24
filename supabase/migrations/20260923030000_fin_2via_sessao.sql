-- =============================================================================
-- 2ª via no chat — a memória curta da conversa.
--
-- O atendimento da 2ª via tem no máximo dois passos: o cliente pede, e quando o
-- telefone não identifica ninguém com segurança, o sistema pergunta o CNPJ e
-- espera a resposta. Essa espera precisa de estado, e ele fica aqui.
--
-- POR QUE UMA TABELA E NÃO O `metadata` DA CONVERSA: o metadata da conversa é
-- escrito por vários pontos do motor de atendimento ao mesmo tempo; guardar
-- estado de fluxo lá é convite para uma escrita apagar a outra. Aqui a chave é
-- a conversa, a linha é minha, e tem validade.
--
-- TUDO EXPIRA. Ninguém fica "aguardando CNPJ" para sempre: passou de
-- `expira_em`, a próxima mensagem começa do zero. É o que evita o cliente voltar
-- três dias depois, mandar "oi" e o sistema entender aquilo como resposta de
-- CNPJ.
-- =============================================================================

create table if not exists public.fin_2via_sessao (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,

  -- aguardando_cnpj: perguntou e espera a resposta.
  -- entregue: já mandou os títulos; serve para não repetir a mesma lista se o
  --           cliente mandar "boleto" três vezes seguidas.
  estado text not null check (estado in ('aguardando_cnpj', 'entregue')),

  cliente_id uuid null references public.clientes(id) on delete set null,

  -- Quantas vezes o CNPJ veio errado. Na terceira, o sistema para de insistir e
  -- entrega a conversa para uma pessoa: ficar pedindo documento a alguém que
  -- não consegue informar é a pior experiência possível.
  tentativas smallint not null default 0,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '30 minutes',

  primary key (tenant_id, conversation_id)
);

comment on table public.fin_2via_sessao is
  'Estado curto do autoatendimento de 2ª via no chat: se está esperando o CNPJ e se já entregou a lista. Expira sozinho; escrita só pelo conector (service_role).';

create index if not exists idx_fin_2via_expira on public.fin_2via_sessao (expira_em);

-- Escrita e leitura são só da edge function (service_role). Ninguém lê isto
-- pela tela: é estado de fluxo, não informação de negócio.
alter table public.fin_2via_sessao enable row level security;

revoke all on public.fin_2via_sessao from anon, authenticated;
grant select, insert, update, delete on public.fin_2via_sessao to service_role;
