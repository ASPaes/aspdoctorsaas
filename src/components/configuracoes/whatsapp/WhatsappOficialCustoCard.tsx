import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useEhAdmin } from "@/hooks/usePortao";
import { useTemWhatsappOficial } from "@/components/whatsappCusto/useWhatsappCusto";
import { lerModo, type ModoCompositor } from "@/components/whatsapp/chat/composerOficial";
import { cn } from "@/lib/utils";

/**
 * Configurações › Atendimento › Operação › Atendimento / CSAT: como o Enter
 * funciona nos números da API Oficial e os valores que a aba de custo usa.
 * Só admin, e só para empresa que tem número da API Oficial.
 */

const MODOS: Array<{ v: ModoCompositor; titulo: string; texto: string; padrao?: boolean }> = [
  { v: "agrupar", titulo: "Agrupar mensagens", padrao: true,
    texto: "O Enter junta o texto numa mensagem pendente e envia tudo junto depois de alguns segundos. O técnico pode enviar na hora, editar ou cancelar." },
  { v: "enter_quebra_linha", titulo: "Enter quebra linha",
    texto: "O Enter só pula linha. Para enviar, Ctrl+Enter ou o botão." },
  { v: "alerta", titulo: "Só avisar",
    texto: "Envia normalmente, mas avisa o técnico quando ele manda várias mensagens seguidas." },
  { v: "desligado", titulo: "Desligado",
    texto: "Como sempre foi: cada Enter é uma mensagem cobrada." },
];

interface Valores {
  meta_compose_mode: ModoCompositor;
  meta_compose_group_seconds: number;
  meta_price_per_message_brl: number;
  meta_free_messages_per_number: number;
}

export function WhatsappOficialCustoCard() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const ehAdmin = useEhAdmin();
  const temOficial = useTemWhatsappOficial(tid).data === true;
  if (!tid || !ehAdmin || !temOficial) return null;
  return <Formulario tid={tid} />;
}

function Formulario({ tid }: { tid: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: cfg, isLoading } = useQuery({
    queryKey: ["configuracoes-wa-oficial", tid],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.from("configuracoes") as any)
        .select("id, meta_compose_mode, meta_compose_group_seconds, meta_price_per_message_brl, meta_free_messages_per_number")
        .eq("tenant_id", tid)
        .maybeSingle();
      if (error) throw error;
      return data as ({ id: string } & Partial<Valores>) | null;
    },
  });

  const [v, setV] = useState<Valores>({
    meta_compose_mode: "agrupar", meta_compose_group_seconds: 4,
    meta_price_per_message_brl: 0.035, meta_free_messages_per_number: 1000,
  });
  useEffect(() => {
    if (!cfg) return;
    setV({
      meta_compose_mode: lerModo(cfg.meta_compose_mode),
      meta_compose_group_seconds: Number(cfg.meta_compose_group_seconds ?? 4),
      meta_price_per_message_brl: Number(cfg.meta_price_per_message_brl ?? 0.035),
      meta_free_messages_per_number: Number(cfg.meta_free_messages_per_number ?? 1000),
    });
  }, [cfg]);

  const segundosOk = Number.isInteger(v.meta_compose_group_seconds) && v.meta_compose_group_seconds >= 2 && v.meta_compose_group_seconds <= 15;
  const precoOk = v.meta_price_per_message_brl >= 0;
  const franquiaOk = Number.isInteger(v.meta_free_messages_per_number) && v.meta_free_messages_per_number >= 0;

  const salvar = useMutation({
    mutationFn: async () => {
      if (!cfg?.id) throw new Error("Configuração da empresa não encontrada.");
      const { error } = await (supabase.from("configuracoes") as any).update(v as any).eq("id", cfg.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["configuracoes-wa-oficial"] });
      qc.invalidateQueries({ queryKey: ["support-config"] });
      qc.invalidateQueries({ queryKey: ["wa-custo-dashboard"] });
      qc.invalidateQueries({ queryKey: ["wa-custo-cliente"] });
      toast({ title: "Salvo", description: "Configuração do WhatsApp Oficial atualizada." });
    },
    onError: (e: any) => toast({ title: "Não foi possível salvar", description: e?.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>WhatsApp Oficial: custo por mensagem</CardTitle>
        <CardDescription>
          A Meta cobra cada mensagem enviada acima da franquia mensal de cada número. Estas opções valem só para os números da API Oficial.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando…</div>
        ) : (
          <>
            <div className="space-y-2">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Como o Enter funciona no chat</Label>
              <RadioGroup
                value={v.meta_compose_mode}
                onValueChange={(m) => setV((x) => ({ ...x, meta_compose_mode: lerModo(m) }))}
                className="grid gap-2"
              >
                {MODOS.map((m) => (
                  <label
                    key={m.v}
                    htmlFor={`wa-modo-${m.v}`}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                      v.meta_compose_mode === m.v ? "border-primary ring-1 ring-primary" : "hover:bg-muted/50",
                    )}
                  >
                    <RadioGroupItem id={`wa-modo-${m.v}`} value={m.v} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="text-sm font-semibold">
                        {m.titulo}
                        {m.padrao && <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 align-[1px] text-[10px] font-semibold text-primary">PADRÃO</span>}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{m.texto}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="wa-segundos">Segundos para agrupar</Label>
                <Input
                  id="wa-segundos"
                  type="number"
                  min={2}
                  max={15}
                  value={Number.isFinite(v.meta_compose_group_seconds) ? v.meta_compose_group_seconds : ""}
                  disabled={v.meta_compose_mode !== "agrupar"}
                  onChange={(e) => setV((x) => ({ ...x, meta_compose_group_seconds: e.target.value === "" ? NaN : Number(e.target.value) }))}
                  aria-invalid={!segundosOk}
                />
                <p className={cn("text-xs", segundosOk ? "text-muted-foreground" : "text-destructive")}>
                  {segundosOk ? "De 2 a 15. Só no modo Agrupar." : "Use um número inteiro de 2 a 15."}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wa-preco">Preço por mensagem (R$)</Label>
                <NumericInput
                  id="wa-preco"
                  decimals={4}
                  value={v.meta_price_per_message_brl}
                  onChange={(n) => setV((x) => ({ ...x, meta_price_per_message_brl: n ?? 0 }))}
                />
                <p className="text-xs text-muted-foreground">Confira na fatura da Meta.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wa-franquia">Franquia por número no mês</Label>
                <Input
                  id="wa-franquia"
                  type="number"
                  min={0}
                  value={Number.isFinite(v.meta_free_messages_per_number) ? v.meta_free_messages_per_number : ""}
                  onChange={(e) => setV((x) => ({ ...x, meta_free_messages_per_number: e.target.value === "" ? NaN : Number(e.target.value) }))}
                  aria-invalid={!franquiaOk}
                />
                <p className={cn("text-xs", franquiaOk ? "text-muted-foreground" : "text-destructive")}>
                  {franquiaOk ? "Usada só enquanto não há o valor real cobrado." : "Use um número inteiro, zero ou mais."}
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => salvar.mutate()}
                disabled={salvar.isPending || !segundosOk || !precoOk || !franquiaOk}
              >
                {salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
