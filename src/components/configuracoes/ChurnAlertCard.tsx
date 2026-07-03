import { useEffect, useState, KeyboardEvent, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, X, Loader2, Plus } from "lucide-react";

interface Recipient {
  user_id: string | null;
  nome: string | null;
  phone: string;
}

interface ChurnConfig {
  churn_alert_enabled: boolean;
  churn_alert_keywords: string[];
  churn_alert_phone_numbers: string[];
  churn_alert_instance_id: string | null;
  churn_alert_recipients: Recipient[];
}

const NONE_VALUE = "__none__";

export default function ChurnAlertCard() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const queryClient = useQueryClient();
  const [keywordInput, setKeywordInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [selectedAdmin, setSelectedAdmin] = useState<string>("");

  const configQueryKey = ["churn-alert-config", tid];
  const usageQueryKey = ["churn-alert-usage", tid];

  const { data: config, isLoading: configLoading } = useQuery<ChurnConfig>({
    queryKey: configQueryKey,
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("configuracoes" as any) as any)
        .select(
          "churn_alert_enabled, churn_alert_keywords, churn_alert_phone_numbers, churn_alert_instance_id, churn_alert_recipients"
        )
        .eq("tenant_id", tid)
        .maybeSingle();
      if (error) throw error;
      const rawRecipients = Array.isArray(data?.churn_alert_recipients)
        ? (data.churn_alert_recipients as Recipient[])
        : [];
      const phones = Array.isArray(data?.churn_alert_phone_numbers)
        ? (data.churn_alert_phone_numbers as string[])
        : [];
      let recipients: Recipient[] = rawRecipients;
      if (recipients.length === 0 && phones.length > 0) {
        recipients = phones.map((p) => ({ user_id: null, nome: null, phone: p }));
      }
      return {
        churn_alert_enabled: !!data?.churn_alert_enabled,
        churn_alert_keywords: Array.isArray(data?.churn_alert_keywords)
          ? data.churn_alert_keywords
          : [],
        churn_alert_phone_numbers: phones,
        churn_alert_instance_id: data?.churn_alert_instance_id ?? null,
        churn_alert_recipients: recipients,
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

  const { data: admins } = useQuery({
    queryKey: ["churn-alert-admins", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data: profs, error } = await (supabase as any)
        .from("profiles")
        .select("user_id, email, funcionario_id")
        .eq("tenant_id", tid)
        .eq("role", "admin");
      if (error) throw error;
      const list = (profs ?? []) as Array<{
        user_id: string;
        email: string | null;
        funcionario_id: string | null;
      }>;
      const funcIds = list.map((p) => p.funcionario_id).filter(Boolean) as string[];
      let nomesById: Record<string, string> = {};
      if (funcIds.length > 0) {
        const { data: funcs } = await (supabase as any)
          .from("funcionarios")
          .select("id, nome")
          .in("id", funcIds);
        for (const f of (funcs ?? []) as Array<{ id: string; nome: string }>) {
          nomesById[f.id] = f.nome;
        }
      }
      return list
        .map((p) => ({
          user_id: p.user_id,
          nome: (p.funcionario_id && nomesById[p.funcionario_id]) || p.email || p.user_id,
        }))
        .sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
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

  const adminOptions = useMemo(() => {
    if (!admins) return [];
    const used = new Set((local?.churn_alert_recipients ?? []).map((r) => r.user_id).filter(Boolean));
    return admins.filter((a) => !used.has(a.user_id));
  }, [admins, local?.churn_alert_recipients]);

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

  const persistRecipients = async (next: Recipient[]) => {
    const phones = next.map((r) => r.phone);
    setLocal({
      ...local,
      churn_alert_recipients: next,
      churn_alert_phone_numbers: phones,
    });
    await persist({
      churn_alert_recipients: next as any,
      churn_alert_phone_numbers: phones,
    });
  };

  const addRecipient = async () => {
    const phone = phoneInput.replace(/\D/g, "");
    if (!phone) {
      toast.error("Informe um número de WhatsApp");
      return;
    }
    if (local.churn_alert_recipients.some((r) => r.phone === phone)) {
      toast.error("Número já cadastrado");
      return;
    }
    const admin = admins?.find((a) => a.user_id === selectedAdmin);
    const rec: Recipient = {
      user_id: admin?.user_id ?? null,
      nome: admin?.nome ?? null,
      phone,
    };
    const next = [...local.churn_alert_recipients, rec];
    setPhoneInput("");
    setSelectedAdmin("");
    await persistRecipients(next);
  };

  const removeRecipient = async (phone: string) => {
    const next = local.churn_alert_recipients.filter((r) => r.phone !== phone);
    await persistRecipients(next);
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

  const onPhoneKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addRecipient();
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
              <Label className="text-sm">Instância de envio dos avisos</Label>
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

            {/* Destinatários */}
            <div className="space-y-2">
              <Label className="text-sm">Administradores que recebem o aviso</Label>
              <div className="flex flex-wrap gap-2">
                {local.churn_alert_recipients.map((r) => (
                  <Badge key={r.phone} variant="secondary" className="gap-1 pr-1">
                    {(r.nome ?? "(sem admin)") + " · " + r.phone}
                    <button
                      type="button"
                      onClick={() => removeRecipient(r.phone)}
                      className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                      aria-label={`Remover ${r.phone}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {local.churn_alert_recipients.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    Nenhum destinatário cadastrado.
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select value={selectedAdmin} onValueChange={setSelectedAdmin}>
                  <SelectTrigger className="sm:w-[240px]">
                    <SelectValue placeholder="Selecione um administrador" />
                  </SelectTrigger>
                  <SelectContent>
                    {adminOptions.length === 0 && (
                      <SelectItem value="__empty__" disabled>
                        Nenhum admin disponível
                      </SelectItem>
                    )}
                    {adminOptions.map((a) => (
                      <SelectItem key={a.user_id} value={a.user_id}>
                        {a.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={onPhoneKeyDown}
                  placeholder="5547999999999"
                  inputMode="numeric"
                  className="sm:flex-1"
                />
                <Button type="button" onClick={addRecipient} variant="secondary">
                  <Plus className="h-4 w-4 mr-1" /> Adicionar
                </Button>
              </div>
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
