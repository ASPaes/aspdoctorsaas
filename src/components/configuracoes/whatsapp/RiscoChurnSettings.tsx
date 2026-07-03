import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldAlert, RotateCcw } from "lucide-react";
import { toast as sonnerToast } from "sonner";
import ChurnAlertCard from "@/components/configuracoes/ChurnAlertCard";

type CampoKey = "risk_dens_mult" | "risk_neg_pct" | "risk_reinc_min" | "risk_csat_min_n";

const DEFAULTS: Record<CampoKey, number> = {
  risk_dens_mult: 2,
  risk_neg_pct: 25,
  risk_reinc_min: 2,
  risk_csat_min_n: 2,
};

const CAMPOS: {
  key: CampoKey; label: string; suffix: string; min: number; max?: number; step: number; oque: string; impacto: string;
}[] = [
  {
    key: "risk_dens_mult", label: "Multiplicador de densidade", suffix: "× a média do tenant", min: 1, step: 0.5,
    oque: "Quantas vezes acima da densidade média de suporte do tenant (interações de chat + ticket por R$ 1.000 de MRR) um cliente precisa estar para disparar este sinal.",
    impacto: "Menor = mais sensível, marca mais contas como caras de atender. Maior = só as mais extremas. Ex.: 2 = o dobro da média do tenant; 3 = o triplo.",
  },
  {
    key: "risk_neg_pct", label: "% de chats negativos", suffix: "%", min: 0, max: 100, step: 5,
    oque: "A partir de qual percentual de chats com sentimento negativo o sinal dispara.",
    impacto: "Menor = insatisfação pontual já conta (mais ruído). Maior = só negatividade consistente. Ex.: 25% = 1 a cada 4 chats negativo.",
  },
  {
    key: "risk_reinc_min", label: "Reincidência mínima de categoria", suffix: "categorias", min: 1, step: 1,
    oque: "Quantas categorias de ticket precisam se repetir (mesmo tipo de problema 2+ vezes) para disparar o sinal.",
    impacto: "Menor = um único problema recorrente já conta. Maior = exige reincidência em mais frentes para sinalizar.",
  },
  {
    key: "risk_csat_min_n", label: "Mínimo de respostas CSAT", suffix: "respostas", min: 1, step: 1,
    oque: "Quantas notas de CSAT o cliente precisa ter para o sinal de CSAT baixo ser avaliado — evita classificar uma conta por uma nota solta.",
    impacto: "Menor = avalia CSAT mesmo com pouca amostra (mais ruído). Maior = só avalia quem tem respostas suficientes. O valor da nota baixa em si vem das configurações de CSAT (limiar de CSAT baixo).",
  },
];

export default function RiscoChurnSettings() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.is_super_admin;
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["risco-churn-config", tid],
    enabled: !!tid && !!isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("configuracoes")
        .select("support_config")
        .eq("tenant_id", tid as string)
        .maybeSingle();
      if (error) throw error;
      return (data?.support_config ?? {}) as Record<string, unknown>;
    },
  });

  useEffect(() => {
    if (!data) return;
    const v: Record<string, string> = {};
    for (const c of CAMPOS) {
      const stored = (data as Record<string, unknown>)[c.key];
      v[c.key] = stored !== undefined && stored !== null ? String(stored) : String(DEFAULTS[c.key]);
    }
    setValues(v);
  }, [data]);

  const mutate = useMutation({
    mutationFn: async (mode: "save" | "reset") => {
      const { data: current, error: getErr } = await supabase
        .from("configuracoes")
        .select("support_config")
        .eq("tenant_id", tid as string)
        .single();
      if (getErr) throw getErr;
      const base = { ...((current?.support_config ?? {}) as Record<string, unknown>) };
      if (mode === "reset") {
        for (const c of CAMPOS) delete base[c.key];
      } else {
        for (const c of CAMPOS) {
          const n = Number(values[c.key]);
          if (!Number.isFinite(n)) throw new Error(`Valor inválido em "${c.label}"`);
          if (n < c.min || (c.max !== undefined && n > c.max)) throw new Error(`"${c.label}" fora do intervalo permitido`);
          base[c.key] = n;
        }
      }
      const { error: updErr } = await supabase
        .from("configuracoes")
        .update({ support_config: base as any })
        .eq("tenant_id", tid as string);
      if (updErr) throw updErr;
      return mode;
    },
    onSuccess: (mode) => {
      queryClient.invalidateQueries({ queryKey: ["risco-churn-config"] });
      queryClient.invalidateQueries({ queryKey: ["atendimento-clientes"] });
      sonnerToast.success(mode === "reset" ? "Padrões restaurados" : "Limiares de risco salvos", {
        description: "A aba Clientes do dashboard de atendimento já usa os novos valores.",
      });
    },
    onError: (err: any) => sonnerToast.error("Erro ao salvar", { description: err?.message || "Tente novamente." }),
  });

  if (!isAdmin) return null;
  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const isMutating = mutate.isPending;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-md bg-muted">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <CardTitle>Risco de churn por conta</CardTitle>
            <CardDescription>
              Cada cliente acumula até 4 sinais; 0 = Baixo, 1–2 = Médio, 3–4 = Alto (visível na aba Clientes do dashboard de atendimento). Em branco / restaurado usa o padrão global.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {CAMPOS.map((c) => (
          <div key={c.key} className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor={c.key}>{c.label}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={c.key}
                  type="number"
                  min={c.min}
                  max={c.max}
                  step={c.step}
                  className="max-w-[160px]"
                  value={values[c.key] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [c.key]: e.target.value }))}
                />
                <span className="text-sm text-muted-foreground">{c.suffix}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground"><span className="font-medium">O que é:</span> {c.oque}</p>
            <p className="text-xs text-muted-foreground"><span className="font-medium">Impacto:</span> {c.impacto}</p>
            <p className="text-xs text-muted-foreground"><span className="font-medium">Padrão:</span> {DEFAULTS[c.key]}{c.suffix === "%" ? "%" : ""}</p>
          </div>
        ))}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => mutate.mutate("reset")} disabled={isMutating}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Restaurar padrão
          </Button>
          <Button onClick={() => mutate.mutate("save")} disabled={isMutating}>
            {isMutating ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
