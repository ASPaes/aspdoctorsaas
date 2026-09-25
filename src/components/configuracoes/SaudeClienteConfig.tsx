import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HelpCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useEhAdmin } from "@/hooks/usePortao";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useSaudePesos } from "@/components/clientes/visao360/useVisao360";
import {
  FAIXAS_SAUDE, FATORES_SAUDE, PESOS_SAUDE_PADRAO, type FatorSaude, type PesosSaude,
} from "@/components/clientes/visao360/visao360Calc";

/**
 * Configurações › Saúde do cliente. Quanto cada fator pesa na nota que aparece
 * em Clientes › Visão 360°. Vale para todos os clientes da empresa.
 *
 * Gravado em `configuracoes.saude_cliente_pesos`. Ninguém precisa entrar aqui
 * para a nota funcionar: sem nada gravado, vale o padrão da plataforma.
 */
export default function SaudeClienteConfig() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const ehAdmin = useEhAdmin();
  const qc = useQueryClient();
  const q = useSaudePesos(tid);
  const [pesos, setPesos] = useState<PesosSaude>(PESOS_SAUDE_PADRAO);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { if (q.data) setPesos(q.data.pesos); }, [q.data]);

  if (!tid) {
    return <Card className="p-6 text-sm text-muted-foreground">Escolha uma empresa no seletor do topo para ver e ajustar os pesos dela.</Card>;
  }

  const soma = (Object.values(pesos) as number[]).reduce((a, b) => a + b, 0);
  const mudou = q.data && (Object.keys(pesos) as FatorSaude[]).some((k) => pesos[k] !== q.data!.pesos[k]);
  const ehPadrao = (Object.keys(pesos) as FatorSaude[]).every((k) => pesos[k] === PESOS_SAUDE_PADRAO[k]);

  const salvar = async () => {
    setSalvando(true);
    try {
      const { data, error } = await (supabase.from("configuracoes" as any) as any)
        .update({ saude_cliente_pesos: pesos })
        .eq("tenant_id", tid)
        .select("tenant_id");
      if (error) throw error;
      if (!data?.length) throw new Error("A empresa ainda não tem as configurações criadas.");
      toast.success("Pesos salvos. A nota dos clientes já usa os novos pesos.");
      qc.invalidateQueries({ queryKey: ["visao360_saude_pesos", tid] });
    } catch (e) {
      const msg = (e as Error)?.message ?? "";
      toast.error(msg.includes("saude_cliente_pesos")
        ? "Os pesos ainda não podem ser salvos nesta versão do banco. Fale com o suporte."
        : `Não deu para salvar: ${msg}`);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="grid max-w-3xl gap-4">
      <Card className="p-5">
        <p className="text-sm text-muted-foreground">
          A nota de saúde aparece no topo de <b className="text-foreground">Clientes › Visão 360°</b> e vai de 0 a 100. Cada fator
          abaixo vale de 0 a 100 e pesa a parte que você escolher aqui. A soma dos pesos precisa dar 100%.
        </p>

        <div className="mt-5 grid gap-5">
          {FATORES_SAUDE.map((f) => (
            <div key={f.chave} className="grid gap-2 sm:grid-cols-[180px_1fr_56px] sm:items-center">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                {f.rotulo}
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" aria-label={`Como ${f.rotulo} é calculado`} className="text-muted-foreground hover:text-foreground">
                      <HelpCircle className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 text-sm">
                    <div className="font-semibold">{f.rotulo}</div>
                    <p className="mt-1 text-muted-foreground">{f.regra}</p>
                  </PopoverContent>
                </Popover>
              </div>
              <Slider
                value={[pesos[f.chave]]}
                min={0}
                max={60}
                step={5}
                disabled={!ehAdmin}
                onValueChange={([v]) => setPesos((p) => ({ ...p, [f.chave]: v }))}
                aria-label={`Peso de ${f.rotulo}`}
              />
              <div className="text-right text-sm font-bold tabular-nums">{pesos[f.chave]}%</div>
            </div>
          ))}
        </div>

        <div className={cn("mt-5 flex items-center justify-between border-t pt-4 text-sm font-bold", soma !== 100 && "text-red-600 dark:text-red-400")}>
          <span>Soma</span>
          <span className="tabular-nums">{soma}%{soma !== 100 && (soma > 100 ? ` · passou ${soma - 100}%` : ` · faltam ${100 - soma}%`)}</span>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" disabled={!ehAdmin || ehPadrao} onClick={() => setPesos(PESOS_SAUDE_PADRAO)}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />Voltar ao padrão
          </Button>
          {ehAdmin ? (
            <Button onClick={salvar} disabled={soma !== 100 || !mudou || salvando}>
              {salvando ? "Salvando…" : "Salvar pesos"}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">Só o administrador da empresa altera os pesos.</span>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <div className="text-sm font-semibold">Faixas da nota</div>
        <div className="mt-3 flex h-2.5 overflow-hidden rounded-full">
          {FAIXAS_SAUDE.map((f) => <span key={f.rotulo} style={{ width: `${f.ate - f.de + 1}%`, background: f.cor }} />)}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
          {FAIXAS_SAUDE.map((f) => (
            <span key={f.rotulo} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: f.cor }} />{f.de} a {f.ate}: <b className="text-foreground">{f.rotulo}</b>
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          O fator Financeiro só entra nas empresas com o Financeiro ligado. Sem ele, o peso dele é dividido entre os outros quatro.
        </p>
      </Card>
    </div>
  );
}
