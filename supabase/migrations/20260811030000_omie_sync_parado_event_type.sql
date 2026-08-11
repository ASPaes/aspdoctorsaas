-- 11/08/2026 — Tipo de evento para o alarme de leitura do Omie parada.
--
-- POR QUE EXISTE: ate hoje o unico sinal de saude do sync incremental era
-- `omie_cron_estado` (projeto DoctorOMIE), que so registra falha quando o bridge devolve
-- `resultados[].ok=false`. REDUNDANT tratado como transitorio -- que tem backoff proprio em
-- `omie_sync_state.bloqueado_ate` -- nunca chega la.
-- MEDIDO em 11/08 03:00: a entidade `clientes` do Digi Office estava em `last_status='erro'`
-- enquanto `omie_cron_estado.ultima_falha_em` continuava carimbado em 24/07 -- 18 dias de
-- verde sobre uma entidade parada. A verdade por entidade sempre esteve na `omie_sync_state`;
-- ninguem a lia.
--
-- QUEM DISPARA: `recon-espelho-pull-cron` v5 (a cada 15 min, por conta Omie). Ele ja falava com
-- o DoctorOMIE autenticado; o `ds-omie-espelho-snapshot` v2 passou a devolver `saude` na pagina 1.
--
-- POR QUE IMPORTA: depois da v17 do `ds-omie-contrato-alterar`, alteracao feita PELO DS chega ao
-- espelho pelo writeback. Alteracao feita DIRETO NO OMIE depende exclusivamente desse
-- incremental. Ele parar em silencio significa a Conferencia comparando com dado velho e
-- mostrando isso como divergencia -- que e justamente o convite para "consertar" a mao no Omie.
--
-- COOLDOWN 360: as regras do cron ja sao lentas (60 min em erro, 120 min sem sincronizar), entao
-- quando isto dispara o problema e real. O cooldown existe para nao repetir de 15 em 15 min
-- enquanto durar: `notify_event` segura por (tenant, evento, dedupe_key) e conta as repeticoes em
-- `notification_incidents.occurrences`. A dedupe_key e por conta+entidade, entao duas unidades
-- quebradas ao mesmo tempo continuam gerando dois alertas distintos.

BEGIN;

INSERT INTO public.notification_event_types
  (key, label, descricao, categoria, default_severity, cooldown_minutes, ativo)
VALUES
  ('omie_sync_parado',
   'Leitura do Omie parada',
   'A leitura automatica que traz do Omie o que mudou por la esta em erro ou parada. Enquanto isso, alteracao feita direto no Omie nao chega ao DoctorSaaS e a Conferencia passa a comparar com dado velho.',
   -- categoria tem CHECK: so 'gestao' ou 'sistema'.
   'sistema', 'warning', 360, true)
ON CONFLICT (key) DO UPDATE
  SET label            = EXCLUDED.label,
      descricao        = EXCLUDED.descricao,
      cooldown_minutes = EXCLUDED.cooldown_minutes,
      ativo            = true;

COMMIT;
