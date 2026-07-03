import { useEffect, useState, KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, X, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface ChurnConfig {
  churn_alert_enabled: boolean;
  churn_alert_keywords: string[];
  churn_alert_instance_id: string | null;
}

const NONE_VALUE = "__none__";

export default function ChurnAlertCard() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [keywordInput, setKeywordInput] = useState("");

  const configQueryKey = ["churn-alert-config", tid];
  const usageQueryKey = ["churn-alert-usage", tid];

  const { data: config, isLoading: configLoading } = useQuery<ChurnConfig>({
    queryKey: configQueryKey,
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("configuracoes" as any) as any)
        .select("churn_alert_enabled, churn_alert_keywords, churn_alert_instance_id")
        .eq("tenant_id", tid)
        .maybeSingle();
      if (error) throw error;
      return {
        churn_alert_enabled: !!data?.churn_alert_enabled,
        churn_alert_keywords: Array.isArray(data?.churn_alert_keywords)
          ? data.churn_alert_keywords
          : [],
        churn_alert_instance_id: data?.churn_alert_instance_id ?? null,
      };
    },
  });

  const { data: instances } = useQuery({
    queryKey: ["whatsapp-instances-churn", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("whatsapp_instances")
        .select("id, instance_name, display_name")
        .eq("tenant_id", tid)
        .eq("is_active", true)
        .order("instance_name");
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        instance_name: string;
        display_name?: string | null;
      }>;
    },
  });

  const startOfMonthIso = (() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
  })();

  const { data: usage } = useQuery({
    queryKey: usageQueryKey,
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("ai_usage_log" as any) as any)
        .select("input_tokens, output_tokens, estimated_cost_usd")
        .eq("tenant_id", tid)
        .eq("function_name", "analyze-whatsapp-sentiment")
        .gte("called_at", startOfMonthIso);
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        input_tokens: number | null;
        output_tokens: number | null;
        estimated_cost_usd: number | null;
      }>;
      return {
        calls: rows.length,
        tokens: rows.reduce(
          (acc, r) => acc + (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
          0
        ),
        cost: rows.reduce((acc, r) => acc + Number(r.estimated_cost_usd ?? 0), 0),
      };
    },
  });

  const persist = async (patch: Partial<ChurnConfig>) => {
    if (!tid) return;
    const { error } = await (supabase.from("configuracoes" as any) as any)
      .update(patch)
      .eq("tenant_id", tid);
    if (error) {
      toast.error("Erro ao salvar alerta de churn");
      return false;
    }
    toast.success("Configuração salva", { duration: 1500 });
    queryClient.invalidateQueries({ queryKey: configQueryKey });
    return true;
  };

  const [local, setLocal] = useState<ChurnConfig | null>(null);

  useEffect(() => {
    if (config) setLocal(config);
  }, [config]);

  if (configLoading || !local) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" /> Alerta de Churn (IA)
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

  const toggleEnabled = async (v: boolean) => {
    setLocal({ ...local, churn_alert_enabled: v });
    await persist({ churn_alert_enabled: v });
  };

  const addKeyword = async () => {
    const kw = keywordInput.trim();
    if (!kw) return;
    if (local.churn_alert_keywords.some((k) => k.toLowerCase() === kw.toLowerCase())) {
      setKeywordInput("");
      return;
    }
    const next = [...local.churn_alert_keywords, kw];
    setLocal({ ...local, churn_alert_keywords: next });
    setKeywordInput("");
    await persist({ churn_alert_keywords: next });
  };

  const removeKeyword = async (kw: string) => {
    const next = local.churn_alert_keywords.filter((k) => k !== kw);
    setLocal({ ...local, churn_alert_keywords: next });
    await persist({ churn_alert_keywords: next });
  };

  const changeInstance = async (v: string) => {
    const next = v === NONE_VALUE ? null : v;
    setLocal({ ...local, churn_alert_instance_id: next });
    await persist({ churn_alert_instance_id: next });
  };

  const onKeywordKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addKeyword();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" /> Alerta de Churn (IA)
        </CardTitle>
        <CardDescription>
          Detecta sinais de cancelamento e avisa os administradores em tempo real
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-1">
            <Label htmlFor="churn_enabled" className="text-sm font-medium">
              Ativar alertas de churn em tempo real
            </Label>
            <p className="text-xs text-muted-foreground">
              Detecta sinais de cancelamento nas mensagens dos clientes usando IA e avisa os
              administradores na hora. Ligar esta opção gera consumo de IA (limitado pelo
              rate-limit do tenant).
            </p>
          </div>
          <Switch
            id="churn_enabled"
            checked={local.churn_alert_enabled}
            onCheckedChange={toggleEnabled}
          />
        </div>

        {local.churn_alert_enabled && (
          <div className="space-y-5 pl-2 border-l-2 border-muted">
            {/* Keywords */}
            <div className="space-y-2">
              <Label className="text-sm">Palavras-chave de disparo</Label>
              <p className="text-xs text-muted-foreground">
                A IA só é chamada quando uma mensagem contém uma dessas palavras.
              </p>
              <div className="flex flex-wrap gap-2">
                {local.churn_alert_keywords.map((kw) => (
                  <Badge key={kw} variant="secondary" className="gap-1 pr-1">
                    {kw}
                    <button
                      type="button"
                      onClick={() => removeKeyword(kw)}
                      className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                      aria-label={`Remover ${kw}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {local.churn_alert_keywords.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    Nenhuma palavra-chave cadastrada.
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onKeyDown={onKeywordKeyDown}
                  placeholder="Ex.: cancelar, não vou usar, descontente"
                />
              </div>
            </div>

            {/* Instância */}
            <div className="space-y-2">
              <Label className="text-sm">Instância emissora de avisos (WhatsApp)</Label>
              <p className="text-xs text-muted-foreground">
                Usada para enviar todos os avisos da central de notificações.
              </p>
              <Select
                value={local.churn_alert_instance_id ?? NONE_VALUE}
                onValueChange={changeInstance}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>
                    Nenhuma (somente notificação no sistema)
                  </SelectItem>
                  {(instances ?? []).map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.display_name || i.instance_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Link para central de notificações */}
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Os destinatários agora são configurados em{" "}
              <button
                type="button"
                onClick={() => navigate("/configuracoes?section=notificacoes")}
                className="underline text-foreground hover:text-primary transition-colors"
              >
                Configurações &gt; Sistema &gt; Notificações
              </button>
              .
            </div>
          </div>
        )}

        {/* Consumo */}
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <div className="font-medium text-foreground mb-1">Consumo deste mês</div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="text-[10px] uppercase">Chamadas</div>
              <div className="text-sm text-foreground tabular-nums">{usage?.calls ?? 0}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase">Tokens</div>
              <div className="text-sm text-foreground tabular-nums">
                {(usage?.tokens ?? 0).toLocaleString("pt-BR")}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase">Custo</div>
              <div className="text-sm text-foreground tabular-nums">
                {new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: "USD",
                  minimumFractionDigits: 4,
                }).format(usage?.cost ?? 0)}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
