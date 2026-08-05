import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { subscribeSharedChannel } from "@/lib/realtimeChannelPool";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { usePresenceRow } from "@/hooks/usePresenceRow";
import { usePermissions } from "@/hooks/usePermissions";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { playQueueBeep, primeQueueBeep } from "@/lib/queueBeep";
import { usePillCounts } from "./usePillCounts";

/** Só um lembrete por episódio de fila cheia (DEM-0203). */
const REMINDER_MS = 2 * 60 * 1000;
const REMINDER_TICK_MS = 15_000;
/** Duração do destaque visual na pill depois de uma entrada. */
const PULSE_MS = 4000;
/** Coalesce de eventos de attendance antes de refazer a contagem. */
const REALTIME_DEBOUNCE_MS = 1500;
/** Fora do Chat o sinal rápido vem do Realtime; o poll é só rede de segurança. */
const IDLE_POLL_MS = 5 * 60 * 1000;
const PRESENCE_POLL_MS = 10 * 60 * 1000;

export interface QueueAlertState {
  /** Nº de conversas aguardando na fila do setor em foco. */
  waiting: number;
  /** True nos segundos seguintes a uma entrada nova — para a pill pulsar. */
  justArrived: boolean;
}

/**
 * Alerta de fila: bip + toast quando entra cliente, e o número que alimenta o
 * badge da pill "Fila".
 *
 * Escopo: montado uma vez no AppLayout, então vale em QUALQUER tela — o problema
 * do DEM-0203 é exatamente o atendente não estar olhando o Chat. O setor segue o
 * `DepartmentFilterContext` (operador comum fica preso ao setor dele; admin/head
 * em "Todos" ouve o tenant inteiro), a mesma regra da lista de conversas.
 *
 * Custo: nenhuma query nova. Reusa a queryKey de `usePillCounts`, então quando o
 * Chat está aberto os dois observadores dividem o mesmo cache e o mesmo RPC.
 */
export function useQueueAlert(): QueueAlertState {
  const { effectiveTenantId: tid } = useTenantFilter();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // Mudança de presença chega por Realtime (canal de usePresenceRow); o poll
  // aqui é só rede de segurança e não pode virar 1 req/min por usuário em todas
  // as telas do sistema.
  const { presence } = usePresenceRow({ refetchInterval: PRESENCE_POLL_MS });
  const { preferences } = useUserPreferences();
  const { can, isLoading: permsLoading } = usePermissions();

  // Quem não tem o Chat não recebe fila nem paga o RPC. `can()` devolve true
  // enquanto carrega, então o `!permsLoading` é o que evita uma chamada por
  // usuário do financeiro em cada sessão.
  const hasChatAccess = !permsLoading && can("nav.chat", "view");

  const { data } = usePillCounts({ refetchInterval: IDLE_POLL_MS, enabled: hasChatAccess });
  const waiting = hasChatAccess ? data?.waiting?.total ?? null : null;

  const [justArrived, setJustArrived] = useState(false);

  const prevWaitingRef = useRef<number | null>(null);
  const reminderDoneRef = useRef(false);
  const episodeStartedAtRef = useRef<number | null>(null);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Agente pausado ou fora do expediente não é alertado. Quem nunca abriu
  // expediente (presence null — admin, head, super admin) continua ouvindo:
  // silenciar por ausência de linha esconderia a fila de quem supervisiona.
  const isMuted = presence?.status === "paused" || presence?.status === "offline";
  const canAlert = preferences.queue_sound_enabled && !isMuted;

  // Refs para o handler não recriar o efeito a cada troca de preferência.
  const canAlertRef = useRef(canAlert);
  canAlertRef.current = canAlert;
  const volumeRef = useRef(0.7);
  volumeRef.current = Math.max(0, Math.min(1, (preferences.queue_sound_volume ?? 70) / 100));

  // Destrava o AudioContext no primeiro gesto do usuário na sessão.
  useEffect(() => {
    const prime = () => primeQueueBeep();
    window.addEventListener("pointerdown", prime, { once: true });
    window.addEventListener("keydown", prime, { once: true });
    return () => {
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("keydown", prime);
    };
  }, []);

  useEffect(() => () => {
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
  }, []);

  // Realtime dedicado. Topic próprio de propósito: `subscribeSharedChannel` roda
  // o `configure` só no PRIMEIRO assinante do topic, então reaproveitar
  // `att-rt-${tid}` (de useAttendanceStatus) faria este handler nunca registrar
  // quando o Chat montasse primeiro.
  useEffect(() => {
    if (!tid || !hasChatAccess) return;
    return subscribeSharedChannel(`queue-alert-${tid}`, (channel) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const invalidate = () => {
        if (timer) return;
        timer = setTimeout(() => {
          timer = null;
          queryClient.invalidateQueries({ queryKey: ["whatsapp", "pill-counts"] });
        }, REALTIME_DEBOUNCE_MS);
      };

      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "support_attendances",
          filter: `tenant_id=eq.${tid}`,
        },
        invalidate
      );
    });
  }, [tid, hasChatAccess, queryClient]);

  // Detecção da borda de subida.
  useEffect(() => {
    if (waiting == null) return;

    const prev = prevWaitingRef.current;
    prevWaitingRef.current = waiting;

    // Primeira leitura da sessão: só calibra. Sem isto, abrir o sistema com 4
    // pessoas na fila dispararia o bip como se as 4 tivessem acabado de chegar.
    if (prev == null) {
      if (waiting > 0) {
        episodeStartedAtRef.current = Date.now();
        reminderDoneRef.current = false;
      }
      return;
    }

    if (waiting === 0) {
      episodeStartedAtRef.current = null;
      reminderDoneRef.current = false;
      return;
    }

    if (waiting <= prev) return;

    if (prev === 0) {
      episodeStartedAtRef.current = Date.now();
      reminderDoneRef.current = false;
    }

    if (!canAlertRef.current) return;

    playQueueBeep(volumeRef.current);

    setJustArrived(true);
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = setTimeout(() => setJustArrived(false), PULSE_MS);

    const novos = waiting - prev;
    toast.info(
      novos > 1 ? `${novos} clientes entraram na fila` : "Cliente aguardando na fila",
      {
        id: "queue-alert",
        description: `${waiting} ${waiting === 1 ? "pessoa aguardando" : "pessoas aguardando"} atendimento.`,
        action: { label: "Ver fila", onClick: () => navigate("/whatsapp") },
      }
    );
  }, [waiting, navigate]);

  // Lembrete único: fila continua com gente 2 min depois do início do episódio.
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => {
      if (reminderDoneRef.current || !canAlertRef.current) return;
      const startedAt = episodeStartedAtRef.current;
      if (!startedAt || Date.now() - startedAt < REMINDER_MS) return;
      reminderDoneRef.current = true;
      playQueueBeep(volumeRef.current);
      toast.warning("Fila ainda com clientes aguardando", {
        id: "queue-alert",
        description: `${waiting} ${waiting === 1 ? "pessoa aguardando" : "pessoas aguardando"} atendimento.`,
        action: { label: "Ver fila", onClick: () => navigate("/whatsapp") },
      });
    }, REMINDER_TICK_MS);
    return () => window.clearInterval(id);
  }, [waiting, navigate]);

  return { waiting: waiting ?? 0, justArrived };
}
