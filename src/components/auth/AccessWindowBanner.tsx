import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  ACCESS_ENDED_KEY,
  type AccessEndedNotice,
  type AccessWindow,
  fetchMyAccessWindow,
  formatarHora,
} from "@/lib/accessWindow";

const RELER_MS = 5 * 60_000; // pega mudança de regra feita pelo admin
const TICK_MS = 15_000;

/**
 * DEM-0415: avisa que o horário de acesso vai acabar e, depois da tolerância,
 * devolve os atendimentos para a fila e desconecta.
 *
 * Quem decide é o banco (`get_my_access_window`); aqui só contamos o tempo.
 * O relógio é o do servidor (corrigido pela diferença medida a cada leitura),
 * senão uma máquina adiantada derrubaria a pessoa antes da hora.
 */
export function AccessWindowBanner() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [win, setWin] = useState<AccessWindow | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const [dispensado, setDispensado] = useState(false);
  const offsetRef = useRef(0);
  const derrubandoRef = useRef(false);

  const ler = useCallback(async () => {
    const w = await fetchMyAccessWindow();
    if (!w) return null;
    offsetRef.current = Date.parse(w.server_now) - Date.now();
    setWin(w);
    return w;
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    ler();
    const t = setInterval(ler, RELER_MS);
    const aoVoltar = () => {
      if (document.visibilityState === "visible") ler();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [user?.id, ler]);

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  const derrubar = useCallback(async () => {
    if (derrubandoRef.current) return;
    derrubandoRef.current = true;
    try {
      // Relê antes de agir: o admin pode ter mudado a regra no meio do caminho.
      const fresca = await ler();
      if (!fresca) return; // sem rede não há como devolver a fila; tenta no próximo tick
      const kickAt = fresca.kick_at ? Date.parse(fresca.kick_at) : null;
      const aindaPode =
        !fresca.restricted ||
        ((fresca.allowed || fresca.in_grace) && kickAt !== null && kickAt > Date.parse(fresca.server_now));
      if (aindaPode) return;

      let released = 0;
      const tid = profile?.tenant_id;
      if (tid && user?.id) {
        // Só mexe na presença de quem está em expediente. Chamar para quem não
        // atende gravaria um "fim de expediente" falso no relatório de jornada.
        const { data: pres } = await supabase
          .from("support_agent_presence")
          .select("status")
          .eq("tenant_id", tid)
          .eq("user_id", user.id)
          .maybeSingle();
        if (pres && pres.status !== "offline") {
          if (fresca.release_queue_on_end) {
            const { data } = await supabase.rpc("agent_presence_set_off_release_queue", { p_tenant_id: tid });
            released = Number((data as any)?.released_count ?? 0);
          } else {
            await supabase.rpc("agent_presence_set_off", { p_tenant_id: tid });
          }
        }
      }

      const aviso: AccessEndedNotice = {
        released,
        next_start_at: fresca.next_start_at ?? null,
        timezone: fresca.timezone ?? "America/Sao_Paulo",
        intervals: fresca.intervals ?? [],
      };
      try {
        sessionStorage.setItem(ACCESS_ENDED_KEY, JSON.stringify(aviso));
      } catch {
        /* sem sessionStorage a tela de login só não mostra o motivo */
      }
      await signOut();
      navigate("/login", { replace: true });
    } catch (err) {
      console.error("[access-window] falha ao encerrar sessão", err);
    } finally {
      derrubandoRef.current = false;
    }
  }, [ler, profile?.tenant_id, user?.id, signOut, navigate]);

  const agoraServidor = agora + offsetRef.current;
  const kickAt = win?.kick_at ? Date.parse(win.kick_at) : null;
  const endsAt = win?.ends_at ? Date.parse(win.ends_at) : null;
  const deveCair =
    !!win?.restricted &&
    ((win.allowed === false && !win.in_grace) || (kickAt !== null && agoraServidor >= kickAt));

  useEffect(() => {
    if (deveCair) derrubar();
  }, [deveCair, agora, derrubar]);

  const tz = win?.timezone ?? "America/Sao_Paulo";
  const aviso = win?.warn_before_minutes ?? null;
  const naTolerancia = endsAt !== null && agoraServidor >= endsAt && !deveCair;
  const noAviso = aviso !== null && endsAt !== null && agoraServidor < endsAt && endsAt - agoraServidor <= aviso * 60_000;
  // A tolerância aparece sempre, mesmo sem aviso configurado e mesmo depois do "Entendi".
  const mostrar = !!win?.restricted && (naTolerancia || (noAviso && !dispensado));

  const { data: abertos = 0 } = useQuery({
    queryKey: ["access-window-abertos", user?.id, profile?.tenant_id],
    enabled: mostrar && !!win?.release_queue_on_end && !!user?.id && !!profile?.tenant_id,
    staleTime: 60_000,
    queryFn: async () => {
      const { count } = await supabase
        .from("support_attendances")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", profile!.tenant_id!)
        .eq("assigned_to", user!.id)
        .eq("status", "in_progress");
      return count ?? 0;
    },
  });

  if (!mostrar) return null;

  const minutos = (alvo: number) => Math.max(1, Math.ceil((alvo - agoraServidor) / 60_000));
  const fila =
    win?.release_queue_on_end && abertos > 0
      ? ` ${abertos === 1 ? "Seu atendimento aberto volta" : `Seus ${abertos} atendimentos abertos voltam`} para a fila.`
      : "";

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-foreground"
    >
      <span className="flex items-center gap-2">
        <Clock className="h-4 w-4 shrink-0 text-amber-500" />
        {naTolerancia && kickAt !== null ? (
          <span>
            Seu horário de acesso terminou às <b className="tabular-nums">{formatarHora(win!.ends_at, tz)}</b>. Você será
            desconectado às <b className="tabular-nums">{formatarHora(win!.kick_at, tz)}</b> (em{" "}
            <b className="tabular-nums">{minutos(kickAt)} min</b>).{fila}
          </span>
        ) : (
          <span>
            Seu horário de acesso termina às <b className="tabular-nums">{formatarHora(win!.ends_at, tz)}</b> (em{" "}
            <b className="tabular-nums">{minutos(endsAt!)} min</b>).{fila}
          </span>
        )}
      </span>
      {!naTolerancia && (
        <Button size="sm" variant="outline" className="h-7" onClick={() => setDispensado(true)}>
          Entendi
        </Button>
      )}
    </div>
  );
}
