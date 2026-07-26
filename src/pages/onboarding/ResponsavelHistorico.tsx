import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ChevronRight, History } from "lucide-react";

interface Periodo {
  id: string;
  user_id: string;
  de: string;
  ate: string | null;
  motivo: string | null;
  transferido_por: string | null;
}

interface Props {
  journeyId: string;
  tenantId: string | null;
  nomePorUserId: Map<string, string>;
}

function fmt(d: string | null) {
  if (!d) return "atual";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function ResponsavelHistorico({ journeyId, tenantId, nomePorUserId }: Props) {
  const [aberto, setAberto] = useState(false);

  const { data: periodos = [] } = useQuery({
    queryKey: ["onboarding-responsavel-history", journeyId],
    enabled: aberto && !!journeyId && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_responsavel_history" as any) as any)
        .select("id, user_id, de, ate, motivo, transferido_por")
        .eq("tenant_id", tenantId)
        .eq("journey_id", journeyId)
        .order("de", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Periodo[];
    },
  });

  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${aberto ? "rotate-90" : ""}`} />
        <History className="h-3.5 w-3.5" />
        Histórico de responsáveis
      </button>

      {aberto && (
        periodos.length === 0 ? (
          <p className="pl-6 pt-1.5 text-[11px] text-muted-foreground">Nenhum registro.</p>
        ) : (
          <ul className="pl-6 pt-1.5 space-y-1.5">
            {periodos.map((p) => (
              <li key={p.id} className="text-[11px] leading-relaxed">
                <span className="font-medium">{nomePorUserId.get(p.user_id) || "—"}</span>
                <span className="text-muted-foreground"> · {fmt(p.de)} → {fmt(p.ate)}</span>
                {p.motivo && (
                  <div className="text-muted-foreground">
                    {p.transferido_por && <>por {nomePorUserId.get(p.transferido_por) || "—"} · </>}
                    {p.motivo}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
