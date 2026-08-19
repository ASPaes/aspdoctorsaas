import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeSharedChannel } from "@/lib/realtimeChannelPool";

/**
 * Chaves que alimentam o quadro das TRÊS jornadas (Onboarding, Implantação e
 * Acompanhamento) mais a gaveta de detalhe aberta por cima dele. Invalidar só
 * refaz o que está montado — as chaves das abas fechadas ficam marcadas como
 * velhas e só buscam quando alguém abrir.
 */
const CHAVES_DO_QUADRO: string[][] = [
  ["onboarding-journeys"],
  ["onboarding-journey-phases"],
  ["onboarding-journeys-tags"],
  ["onboarding-training-cards"],
  ["onboarding-board-trainings"],
  ["onb-acompanhamento-board"],
  ["onboarding-journey-detail"],
  ["onboarding-journey-row"],
  ["onboarding-journey-phases-detail"],
  ["onboarding-stage-history"],
  ["onboarding-ticket-events"],
  ["onboarding-journey-checklist"],
  ["onboarding-journey-checklist-all"],
];

/** Tag não mexe em nenhuma outra chave: quem muda é só a lista de tags do quadro
 *  e a da gaveta de detalhe. Refazer o quadro inteiro por uma tag seria desperdício. */
const CHAVES_DE_TAG: string[][] = [
  ["onboarding-journeys-tags"],
  ["onboarding-journey-tags"],
];

/** Janela de agrupamento. Uma RPC de quadro escreve várias linhas (jornada +
 *  histórico + 2 ou 3 eventos de ticket); sem isso cada uma viraria um refetch.
 *  Também é o teto de tráfego: no pior caso o quadro se refaz 1x por janela. */
const JANELA_MS = 1200;

/**
 * Mantém o quadro de Implantação vivo sem F5.
 *
 * Por que ouvir `support_tickets` / `support_ticket_events` e não as tabelas de
 * onboarding: **toda** ação do quadro passa por elas. `move_onboarding_stage`,
 * `move_onboarding_training_stage`, `transfer_onboarding_responsavel`,
 * `create_onboarding_journey`, `update_onboarding_journey_info`,
 * `conclude_onboarding_journey` e `move_acompanhamento_stage` gravam em
 * `support_ticket_events` (e o Acompanhamento também em `support_tickets`).
 * As duas já estão na publication `supabase_realtime` desde a migration
 * 20260619131241 — as `onboarding_*` não estão, e usá-las exigiria DDL em
 * produção mais WAL novo. Aqui o custo de replicação é zero.
 *
 * Consequência conhecida: um evento de ticket que não é de onboarding também
 * dispara o refetch. É de propósito — filtrar por tipo de evento economizaria
 * pouco e reintroduziria o bug original (a tela parada) toda vez que alguém
 * criasse um tipo novo. A janela de agrupamento é quem segura o tráfego.
 *
 * Tag de jornada é o único caso que não passa por ticket: a tela escreve direto
 * em `onboarding_journey_tags`. Ela ganha um canal SEPARADO (e só invalida as
 * chaves de tag, não o quadro inteiro) — separado de propósito, para que a tabela
 * mais nova na publication não possa derrubar o canal do quadro se algo der
 * errado nela. Depende da migration 20260818233000.
 */
export function useOnboardingBoardRealtime(tenantId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!tenantId) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const agendarRefetch = () => {
      if (timer) return; // já há um voo marcado; a rajada inteira cabe nele
      timer = setTimeout(() => {
        timer = null;
        CHAVES_DO_QUADRO.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
      }, JANELA_MS);
    };

    const onStatus = (status: string) => {
      // postgres_changes não tem replay: o que passou durante uma queda não
      // chega nunca. Toda vez que o canal (re)assina, buscar o intervalo perdido.
      if (status === "SUBSCRIBED") agendarRefetch();
    };

    const cleanup = subscribeSharedChannel(
      `onb-board-rt-${tenantId}`,
      (channel) => {
        // Filtro server-side por tenant: corta o fanout dos outros tenants antes
        // de chegar no browser. Só é correto porque o topic acima usa a MESMA
        // variável — senão dois tenants dividiriam um canal com filtros diferentes.
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table: "support_ticket_events", filter: `tenant_id=eq.${tenantId}` },
          agendarRefetch,
        );
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table: "support_tickets", filter: `tenant_id=eq.${tenantId}` },
          agendarRefetch,
        );
      },
      onStatus,
    );

    return () => {
      if (timer) clearTimeout(timer);
      cleanup();
    };
  }, [tenantId, queryClient]);

  useEffect(() => {
    if (!tenantId) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const agendarRefetchDeTags = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        CHAVES_DE_TAG.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
      }, JANELA_MS);
    };

    const cleanup = subscribeSharedChannel(
      `onb-tags-rt-${tenantId}`,
      (channel) => {
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table: "onboarding_journey_tags", filter: `tenant_id=eq.${tenantId}` },
          agendarRefetchDeTags,
        );
      },
    );

    return () => {
      if (timer) clearTimeout(timer);
      cleanup();
    };
  }, [tenantId, queryClient]);
}
