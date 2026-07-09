import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, Wallet } from "lucide-react";

interface AICostConfig {
  sentiment_analysis_enabled: boolean;
  ai_monthly_budget_usd: number | null;
  ai_budget_alert_pct: number;
}

const fmtUsd = (v: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(v);

export default function AICostControlCard() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.is_super_admin;
  const queryClient = useQueryClient();

  const configKey = ["ai-cost-control-config", tid];
  const spendKey = ["ai-month-spend-usd", tid];

  const { data: config, isLoading: configLoading } = useQuery<AICostConfig>({
    queryKey: configKey,
    enabled: !!tid && !!isAdmin,
    queryFn: async () => {
      const { data, error } = await (supabase.from("configuracoes" as any) as any)
        .select("sentiment_analysis_enabled, ai_monthly_budget_usd, ai_budget_alert_pct")
        .eq("tenant_id", tid)
        .maybeSingle();
      if (error) throw error;
      return {
        sentiment_analysis_enabled: data?.sentiment_analysis_enabled ?? true,
        ai_monthly_budget_usd:
          data?.ai_monthly_budget_usd === null || data?.ai_monthly_budget_usd === undefined
            ? null
            : Number(data.ai_monthly_budget_usd),
        ai_budget_alert_pct: data?.ai_budget_alert_pct ?? 80,
      };
    },
  });

  const { data: spend } = useQuery<number>({
    queryKey: spendKey,
    enabled: !!tid && !!isAdmin,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("ai_month_spend_usd", {
        p_tenant_id: tid,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
  });

  const [enabled, setEnabled] = useState(true);
  const [budget, setBudget] = useState<string>("");
  const [alertPct, setAlertPct] = useState<string>("80");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!config) return;
    setEnabled(config.sentiment_analysis_enabled);
    setBudget(config.ai_monthly_budget_usd === null ? "" : String(config.ai_monthly_budget_usd));
    setAlertPct(String(config.ai_budget_alert_pct));
  }, [config]);

  if (!isAdmin) return null;

  if (configLoading || !config) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" /> Controle de custo de IA
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const handleSave = async () => {
    if (!tid) return;
    const budgetNum = budget.trim() === "" ? null : Number(budget);
    if (budgetNum !== null && (!Number.isFinite(budgetNum) || budgetNum < 0)) {
      toast.error("Teto de gasto inválido");
      return;
    }
    const pctNum = Number(alertPct);
    if (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100) {
      toast.error("Percentual de aviso deve estar entre 0 e 100");
      return;
    }
    setSaving(true);
    const { error } = await (supabase.from("configuracoes" as any) as any)
      .update({
        sentiment_analysis_enabled: enabled,
        ai_monthly_budget_usd: budgetNum,
        ai_budget_alert_pct: Math.round(pctNum),
      } as any)
      .eq("tenant_id", tid);
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar", { description: error.message });
      return;
    }
    toast.success("Configurações salvas");
    queryClient.invalidateQueries({ queryKey: configKey });
    queryClient.invalidateQueries({ queryKey: spendKey });
  };

  const spendValue = spend ?? 0;
  const budgetNumForBar = budget.trim() === "" ? null : Number(budget);
  const hasBudget = budgetNumForBar !== null && Number.isFinite(budgetNumForBar) && budgetNumForBar > 0;
  const pctUsed = hasBudget ? Math.min(100, (spendValue / (budgetNumForBar as number)) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" /> Controle de custo de IA
        </CardTitle>
        <CardDescription>
          A análise de sentimento roda num modelo econômico decidido pela plataforma. Ao atingir
          o teto, ela é pausada automaticamente até virar o mês ou você aumentar o teto.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-md border bg-muted/30 px-3 py-3 space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs uppercase text-muted-foreground">Gasto do mês</span>
            <span className="text-lg font-semibold tabular-nums">{fmtUsd(spendValue)}</span>
          </div>
          {hasBudget && (
            <>
              <Progress value={pctUsed} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{pctUsed.toFixed(1)}% do teto</span>
                <span>Teto: {fmtUsd(budgetNumForBar as number)}</span>
              </div>
            </>
          )}
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-1">
            <Label htmlFor="sentiment_enabled" className="text-sm font-medium">
              Análise de sentimento
            </Label>
            <p className="text-xs text-muted-foreground">
              Quando desligada, mensagens não são analisadas por IA de sentimento.
            </p>
          </div>
          <Switch id="sentiment_enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="budget_usd" className="text-sm">
              Teto de gasto mensal (US$)
            </Label>
            <Input
              id="budget_usd"
              type="number"
              min={0}
              step="0.01"
              placeholder="Sem teto"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Vazio = sem limite.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="alert_pct" className="text-sm">
              Avisar ao atingir (%)
            </Label>
            <Input
              id="alert_pct"
              type="number"
              min={0}
              max={100}
              step={1}
              value={alertPct}
              onChange={(e) => setAlertPct(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Entre 0 e 100.</p>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvando...
              </>
            ) : (
              "Salvar"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
