import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, EyeOff, Loader2, Search } from "lucide-react";

// ============================================================================
// A escolha do cliente de uma filial do OEM.
//
// O casamento automático é por CNPJ; quando o CNPJ tem mais de um cliente, a
// máquina para e a decisão vem para cá. Medido em 14/08/2026: 188 CNPJs têm
// mais de uma filial, um deles com 38 — por isso a lista de candidatos mostra
// cidade e mensalidade, que é o que distingue duas lojas da mesma rede.
//
// A busca livre existe porque nem toda filial casa por CNPJ: matriz e filial
// às vezes estão cadastradas com CNPJs diferentes no DoctorSaaS.
// ============================================================================

export type LinhaRecon = {
  id: string;
  cnpj_norm: string | null;
  empresa_codigo: string | null;
  filial_codigo: string | null;
  razao_oem: string | null;
  custo_oem: number | null;
  qtd_candidatos_ds: number;
  ds_customer_id: string | null;
};

type Candidato = {
  id: string;
  nome_fantasia: string | null;
  razao_social: string | null;
  cnpj: string | null;
  cnpj_digits: string | null;
  mensalidade: number | null;
  cancelado: boolean;
};

const brl = (v: number | null | undefined) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function EscolherClienteOemDialog({
  linha, tenantId, unidades, aberto, onOpenChange, onDecidido,
}: {
  linha: LinhaRecon | null;
  tenantId: string;
  unidades: number[];
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  onDecidido: () => void;
}) {
  const { toast } = useToast();
  const [busca, setBusca] = useState("");
  const [gravando, setGravando] = useState<string | null>(null);

  // Candidatos por CNPJ — é o que a sincronização já achou e não soube desempatar.
  const { data: candidatos = [], isLoading } = useQuery({
    queryKey: ["oem-candidatos", linha?.id, linha?.cnpj_norm],
    enabled: aberto && !!linha?.cnpj_norm,
    queryFn: async () => {
      let q = (supabase.from("clientes") as any)
        .select("id, nome_fantasia, razao_social, cnpj, cnpj_digits, mensalidade, cancelado")
        .eq("tenant_id", tenantId)
        .eq("cnpj_digits", linha!.cnpj_norm);
      if (unidades.length) q = q.in("unidade_base_id", unidades);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Candidato[];
    },
  });

  // Busca livre: só dispara com 3+ caracteres, senão varre a base a cada tecla.
  const termo = busca.trim();
  const { data: achados = [], isFetching: buscando } = useQuery({
    queryKey: ["oem-busca-cliente", tenantId, termo, unidades.join(",")],
    enabled: aberto && termo.length >= 3,
    queryFn: async () => {
      const digitos = termo.replace(/\D/g, "");
      let q = (supabase.from("clientes") as any)
        .select("id, nome_fantasia, razao_social, cnpj, cnpj_digits, mensalidade, cancelado")
        .eq("tenant_id", tenantId)
        .limit(20);
      q = digitos.length >= 3
        ? q.like("cnpj_digits", `%${digitos}%`)
        : q.or(`nome_fantasia.ilike.%${termo}%,razao_social.ilike.%${termo}%`);
      if (unidades.length) q = q.in("unidade_base_id", unidades);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Candidato[];
    },
  });

  async function vincular(clienteId: string) {
    if (!linha) return;
    setGravando(clienteId);
    try {
      const { error } = await (supabase as any).rpc("vincular_filial_oem", {
        p_recon_id: linha.id,
        p_cliente_id: clienteId,
      });
      if (error) throw error;
      toast({ title: "Filial vinculada", description: "A decisão sobrevive às próximas sincronizações." });
      onDecidido();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Não deu para vincular", description: e?.message ?? "Erro", variant: "destructive" });
    } finally {
      setGravando(null);
    }
  }

  async function ignorar() {
    if (!linha) return;
    setGravando("ignorar");
    try {
      const { error } = await (supabase as any).rpc("ignorar_filial_oem", {
        p_recon_id: linha.id,
        p_observacao: null,
      });
      if (error) throw error;
      toast({ title: "Filial ignorada", description: "Sai da fila sem criar vínculo." });
      onDecidido();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Não deu para ignorar", description: e?.message ?? "Erro", variant: "destructive" });
    } finally {
      setGravando(null);
    }
  }

  // Um cliente já listado nos candidatos não precisa aparecer de novo na busca.
  const idsCandidatos = new Set(candidatos.map((c) => c.id));
  const extras = achados.filter((c) => !idsCandidatos.has(c.id));

  const Linha = ({ c }: { c: Candidato }) => (
    <div className="flex items-center gap-3 p-3 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-medium truncate">
          {c.nome_fantasia || c.razao_social || "(sem nome)"}
          {c.cancelado && <Badge variant="outline" className="ml-2 text-xs">cancelado</Badge>}
        </p>
        <p className="text-xs text-muted-foreground">
          CNPJ {c.cnpj || c.cnpj_digits || "—"} · mensalidade que ele paga {brl(c.mensalidade)}
          {linha?.custo_oem != null && (
            <> · margem se vincular{" "}
              <strong className={
                Number(c.mensalidade || 0) - Number(linha.custo_oem) < 0 ? "text-destructive" : ""
              }>
                {brl(Number(c.mensalidade || 0) - Number(linha.custo_oem))}
              </strong>
            </>
          )}
        </p>
      </div>
      <Button size="sm" onClick={() => vincular(c.id)} disabled={!!gravando} className="gap-1.5 shrink-0">
        {gravando === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        Vincular
      </Button>
    </div>
  );

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Escolher o cliente desta filial</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p>
                Em cima, a <strong>filial do OEM</strong> (a licença). Embaixo, os{" "}
                <strong>clientes do DoctorSaaS</strong>. Vincular diz que aquela licença é
                daquele cliente.
              </p>
              {linha && (
                <div className="rounded-md border bg-muted/40 px-3 py-2 text-foreground">
                  <p className="font-medium">
                    <span className="mr-1.5 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400">
                      OEM
                    </span>
                    {linha.razao_oem}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    filial {linha.filial_codigo} · grupo {linha.empresa_codigo} · CNPJ{" "}
                    {linha.cnpj_norm ?? "—"} · <strong>custo da licença {brl(linha.custo_oem)}</strong>
                  </p>
                </div>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">
              Clientes do DoctorSaaS com este CNPJ ({candidatos.length})
            </p>
            {isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : candidatos.length === 0 ? (
              <p className="text-sm text-muted-foreground rounded-md border p-3">
                Nenhum cliente com este CNPJ nesta unidade. Use a busca abaixo.
              </p>
            ) : (
              <div className="rounded-md border divide-y max-h-56 overflow-y-auto">
                {candidatos.map((c) => <Linha key={c.id} c={c} />)}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">
              Ou procure outro cliente do DoctorSaaS
            </p>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Nome ou CNPJ (mínimo 3 caracteres)"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            {termo.length >= 3 && (
              <div className="rounded-md border divide-y max-h-56 overflow-y-auto mt-2">
                {buscando ? (
                  <div className="p-3 text-sm text-muted-foreground">Procurando…</div>
                ) : extras.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">Nada encontrado.</div>
                ) : (
                  extras.map((c) => <Linha key={c.id} c={c} />)
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={ignorar} disabled={!!gravando} className="gap-1.5">
            {gravando === "ignorar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <EyeOff className="h-4 w-4" />}
            Ignorar esta filial
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={!!gravando}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
