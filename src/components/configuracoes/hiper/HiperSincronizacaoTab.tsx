import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Calculator } from "lucide-react";
import { Explica, Vazio, num } from "./ui";

/**
 * O histórico de LEITURA. Diferente do OEM, aqui não existe fila de escrita:
 * nada sai daqui para o Hiper, então não há o que dar errado do outro lado.
 */
export default function HiperSincronizacaoTab({
  tid, runs, semFornecedor,
}: { tid: string | null; runs: any[]; semFornecedor: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [puxando, setPuxando] = useState(false);
  const [reconciliando, setReconciliando] = useState(false);

  const invalidar = () =>
    ["hiper_espelho", "hiper_modulos", "hiper_filiais", "hiper_recon", "hiper_runs", "hiper_integration"]
      .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const chamar = async (acao: "puxar" | "reconciliar") => {
    const set = acao === "puxar" ? setPuxando : setReconciliando;
    set(true);
    try {
      const { data, error } = await supabase.functions.invoke("hiper-integration-call", {
        body: { acao, tenant_id: tid },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falhou.");
      const r = data.resultado ?? {};
      toast({
        title: acao === "puxar" ? "Espelho atualizado" : "Reconciliação recalculada",
        description: acao === "puxar"
          ? `${num(r.contas)} contas, ${num(r.modulos)} módulos, ${num(r.filiais)} filiais${r.portal_atualizado === false ? " · portal ainda sem módulos/filiais" : ""}`
          : `${num(r?.pendentes)} pendências`,
      });
      invalidar();
    } catch (e: any) {
      toast({ title: "Falhou", description: e.message || "Erro de rede.", variant: "destructive" });
    } finally { set(false); }
  };

  return (
    <div className="space-y-3">
      <Explica>
        Puxar o espelho lê a carteira inteira do PortalHiper e regrava o retrato daqui — é
        leitura pura, <strong>nada é enviado para o Hiper</strong>. Ao terminar, a reconciliação
        roda sozinha. Reconciliar de novo, sem puxar, serve para depois de mexer nos vínculos
        da aba Módulos.
      </Explica>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => chamar("puxar")} disabled={puxando || reconciliando || semFornecedor}>
          {puxando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Atualizar espelho agora
        </Button>
        <Button variant="outline" onClick={() => chamar("reconciliar")} disabled={puxando || reconciliando || semFornecedor}>
          {reconciliando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
          Só reconciliar
        </Button>
        {semFornecedor && (
          <span className="text-xs text-amber-600 dark:text-amber-500">
            Escolha o fornecedor na aba Conexão primeiro.
          </span>
        )}
      </div>

      {runs.length === 0 ? (
        <Vazio>Nenhuma sincronização ainda. O histórico aparece aqui a partir da primeira.</Vazio>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Quando</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Contas</th>
                <th className="px-3 py-2 text-right font-medium">Módulos</th>
                <th className="px-3 py-2 text-right font-medium">Filiais</th>
                <th className="px-3 py-2 text-right font-medium">Pendências</th>
                <th className="px-3 py-2 text-left font-medium">Observação</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {new Date(r.iniciado_em).toLocaleString("pt-BR")}
                  </td>
                  <td className="px-3 py-2">
                    {r.status === "ok" ? <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">OK</Badge>
                      : r.status === "erro" ? <Badge variant="destructive">Erro</Badge>
                      : <Badge variant="secondary">Rodando…</Badge>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.contas ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.modulos ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.filiais ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.recon_pendentes ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.erro ? <span className="text-destructive">{r.erro}</span>
                      : r.truncado ? "Truncado no teto de páginas"
                      : r.origem === "cron" ? "Automático" : "Manual"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
