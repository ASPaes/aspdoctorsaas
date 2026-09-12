-- DEM-0400: intervalo entre avisos de fora do horário configurável por tenant.
--
-- Até aqui o intervalo era 5 minutos fixo no código (message-processor.ts chamava
-- try_claim_off_hours_notice com p_cooldown_minutes: 5). Cliente que manda várias
-- mensagens de madrugada recebia um aviso a cada 5 min. A RPC já aceita o intervalo
-- como parâmetro e guarda o último aviso em whatsapp_conversations.metadata, então
-- só falta onde o tenant escolher o valor.
--
-- Padrão 5 = comportamento de antes, nenhum tenant muda sem mexer na tela.
-- Teto de 720 (12h): acima disso o aviso de uma noite bloquearia o da noite seguinte.
--
-- configuracoes é lida a cada mensagem recebida (getSupportConfig). ADD COLUMN com
-- default constante não reescreve a tabela, mas pede lock exclusivo; o lock_timeout
-- evita que a fila de webhooks fique presa atrás dele. Se estourar, é só rodar de novo.

set lock_timeout = '5s';

alter table public.configuracoes
  add column if not exists business_hours_notice_cooldown_minutes integer not null default 5
    constraint configuracoes_bh_notice_cooldown_chk
    check (business_hours_notice_cooldown_minutes between 1 and 720);

comment on column public.configuracoes.business_hours_notice_cooldown_minutes is
  'DEM-0400: minutos mínimos entre dois avisos de fora do horário na mesma conversa (1 a 720, padrão 5).';
