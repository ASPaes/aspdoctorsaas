import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Send, Loader2, AlertTriangle, Cloud, CheckCircle } from "lucide-react";

interface Props {
  clienteId: string;
}

interface ContratoAtivo {
  id: string;
  numero: string | null;
  vlr_total_mensal: number | null;
  modelos_contrato?: { nome: string } | null;
  sincronizado: boolean;
  codigo_contrato_omie: string | number | null;
}

const brl = (v: any) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v ?? 0));

const fmtDate = (v: any) => {
  if (!v) return "—";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }
  return s;
};

function SincronizadoBadge({ codigo }: { codigo: string | number | null }) {
  return (
    <Badge
      variant="outline"
      className="gap-1 text-emerald-700 border-emerald-300 dark:text-emerald-400 dark:border-emerald-900"
    >
      <CheckCircle className="h-3 w-3" />
      Sincronizado com o Omie
      {codigo != null && (
        <span className="ml-1 font-mono text-[11px]">({codigo})</span>
      )}
    </Badge>
  );
}

function EnviarBotao({
  tenantId,
  contrato,
}: {
  tenantId: string;
  contrato: ContratoAtivo;
}) {
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bloqueioOpen, setBloqueioOpen] = useState(false);
  const [bloqueioMsg, setBloqueioMsg] = useState<string>("");
  const [dryRun, setDryRun] = useState<any | null>(null);

  if (contrato.sincronizado) {
    return <SincronizadoBadge codigo={contrato.codigo_contrato_omie} />;
  }

  const handleClick = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("recon-omie-escrever", {
        body: { tenant_id: tenantId, ds_contract_id: contrato.id, modo: "dry_run" },
      });
      if (error) {
        toast.error("Falha ao preparar o envio. Tente novamente.");
        return;
      }
      if (data?.ok === false) {
        const msg =
          data?.erro ||
          data?.mensagem ||
          (data?.bloqueado ? `Bloqueado: ${data.bloqueado}` : "Não é possível enviar este contrato.");
        setBloqueioMsg(String(msg));
        setBloqueioOpen(true);
        return;
      }
      if (data?.ok) {
        setDryRun(data);
        setConfirmOpen(true);
        return;
      }
      toast.error("Resposta inesperada do servidor.");
    } catch {
      toast.error("Falha ao preparar o envio. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("recon-omie-escrever", {
        body: { tenant_id: tenantId, ds_contract_id: contrato.id, modo: "criar" },
      });
      if (error) {
        toast.error("Falha ao enviar ao Omie. Tente novamente.");
        return;
      }
      if (data?.ok) {
        const omieId =
          data?.omie_contract_id ||
          data?.contrato?.omie_contract_id ||
          data?.criado?.omie_contract_id ||
          "";
        const suffix = data?.vendedor_pendente ? " (vendedor pendente)" : "";
        toast.success(
          omieId
            ? `Enviado ao Omie: contrato ${omieId}${suffix}`
            : `Enviado ao Omie com sucesso${suffix}`
        );
        setConfirmOpen(false);
        setDryRun(null);
        return;
      }
      const msg = data?.erro || data?.mensagem || "Falha ao enviar ao Omie.";
      toast.error(String(msg));
    } catch {
      toast.error("Falha ao enviar ao Omie. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const cli = dryRun?.cliente_seria_enviado;
  const ctr = dryRun?.contrato_seria_enviado;
  const jaExiste = !!dryRun?.casado_no_omie;

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={handleClick} disabled={loading}>
        {loading ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Send className="h-4 w-4 mr-2" />
        )}
        Enviar ao Omie
      </Button>

      <AlertDialog open={bloqueioOpen} onOpenChange={setBloqueioOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Não é possível enviar este contrato
            </AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap">
              {bloqueioMsg}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>Entendi</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(v) => {
          if (!loading) setConfirmOpen(v);
        }}
      >
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar envio ao Omie</AlertDialogTitle>
            <AlertDialogDescription>
              Confira os dados que serão enviados ao Omie.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 text-sm">
            {jaExiste && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                Este contrato JÁ existe no Omie e será ATUALIZADO (não duplicado).
              </div>
            )}
            <div className="rounded-md border p-3 space-y-1">
              <div className="text-xs uppercase text-muted-foreground">Cliente</div>
              <div className="font-medium">{cli?.razao_social ?? cli?.nome ?? "—"}</div>
              <div className="text-muted-foreground text-xs">
                CNPJ/CPF: {cli?.cnpj_cpf ?? cli?.documento ?? "—"}
              </div>
            </div>
            <div className="rounded-md border p-3 space-y-1">
              <div className="text-xs uppercase text-muted-foreground">Contrato</div>
              <div className="font-medium">Nº {ctr?.numero ?? contrato.numero ?? "—"}</div>
              <div>Valor mensal: {brl(ctr?.valor_mensal ?? ctr?.vlr_total_mensal)}</div>
              {(ctr?.modelo || ctr?.modelo_nome) && (
                <div>Modelo: {ctr?.modelo ?? ctr?.modelo_nome}</div>
              )}
              <div>
                Vigência: {fmtDate(ctr?.vigencia_inicial ?? ctr?.data_inicio)} até{" "}
                {fmtDate(ctr?.vigencia_final ?? ctr?.data_fim)}
              </div>
              {ctr?.dia_vencimento != null && <div>Dia de vencimento: {ctr.dia_vencimento}</div>}
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirm();
              }}
              disabled={loading}
            >
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirmar envio ao Omie
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function IntegracaoOmieCard({ clienteId }: Props) {
  const { effectiveTenantId: tid } = useTenantFilter();

  const integracaoAtivaQuery = useQuery({
    queryKey: ["omie_integration_ativa", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("omie_integration")
        .select("ativo")
        .eq("tenant_id", tid as string)
        .maybeSingle();
      if (error) throw error;
      return data?.ativo === true;
    },
  });

  const contratosQuery = useQuery({
    queryKey: ["contratos_ativos_omie", tid, clienteId],
    enabled: !!clienteId && !!tid && integracaoAtivaQuery.data === true,
    queryFn: async () => {
      let q = (supabase.from("contratos") as any)
        .select("id, numero, vlr_total_mensal, status, modelos_contrato:modelo_contrato_id(nome)")
        .eq("cliente_id", clienteId)
        .eq("status", "ativo")
        .order("numero", { ascending: false });
      if (tid) q = q.eq("tenant_id", tid);
      const { data: contratos, error } = await q;
      if (error) throw error;

      const ids = (contratos ?? []).map((c: any) => c.id);
      let vinculos: any[] = [];
      if (ids.length > 0) {
        const { data: v, error: vError } = await supabase
          .from("reconciliacao_cadastro")
          .select("ds_contract_id, codigo_contrato_omie")
          .eq("tenant_id", tid)
          .eq("estado_match", "CASADO")
          .not("codigo_contrato_omie", "is", null)
          .in("ds_contract_id", ids);
        if (vError) throw vError;
        vinculos = v ?? [];
      }

      const vinculoMap = new Map<string, string | number>(
        vinculos.map((v) => [v.ds_contract_id, v.codigo_contrato_omie])
      );

      return (contratos ?? []).map((c: any) => {
        const codigo = vinculoMap.get(c.id) ?? null;
        return {
          ...c,
          sincronizado: codigo != null,
          codigo_contrato_omie: codigo,
        } as ContratoAtivo;
      });
    },
  });

  // Não renderiza nada enquanto não souber se a integração está ativa.
  if (!tid || integracaoAtivaQuery.data !== true) {
    return null;
  }

  const contratos = contratosQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="h-5 w-5" />
          Integração Omie
        </CardTitle>
      </CardHeader>
      <CardContent>
        {contratosQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando contratos...</div>
        ) : contratos.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Este cliente não possui contratos ativos para enviar ao Omie.
          </div>
        ) : contratos.length === 1 ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm min-w-0">
              <div className="font-medium">
                Contrato Nº {contratos[0].numero ?? "—"}
              </div>
              <div className="text-muted-foreground text-xs">
                {brl(contratos[0].vlr_total_mensal)}/mês
                {contratos[0].modelos_contrato?.nome
                  ? ` · ${contratos[0].modelos_contrato.nome}`
                  : ""}
              </div>
            </div>
            <EnviarBotao tenantId={tid} contrato={contratos[0]} />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              Este cliente possui {contratos.length} contratos ativos. Escolha qual enviar:
            </div>
            {contratos.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 border rounded-md p-3 flex-wrap"
              >
                <div className="text-sm min-w-0">
                  <div className="font-medium font-mono">Nº {c.numero ?? "—"}</div>
                  <div className="text-muted-foreground text-xs flex items-center gap-2">
                    <Badge variant="secondary">{brl(c.vlr_total_mensal)}/mês</Badge>
                    {c.modelos_contrato?.nome && <span>{c.modelos_contrato.nome}</span>}
                  </div>
                </div>
                <EnviarBotao tenantId={tid} contrato={c} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
