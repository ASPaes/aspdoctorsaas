import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useOmieContaDoCliente } from "@/hooks/useOmieContaDoCliente";
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

function extrairMensagemErro(corpo: any): string {
  if (corpo == null) return "";

  const mensagemDe = (obj: any): string => {
    if (obj == null) return "";

    const base =
      (obj.error ? String(obj.error) : "") ||
      (obj.erro ? String(obj.erro) : "") ||
      (obj.mensagem ? String(obj.mensagem) : "");

    // `erros` é a lista de motivos do montar_payload_contrato_omie (contrato sem produto, sem
    // Data da Venda, cliente fora do escopo da unidade...). A omie-integration-call embrulha
    // tudo isso num `bloqueado: "validacao"` sem `error`, então, sem ler `erros` aqui, a tela
    // mostrava só "Bloqueado: validacao" e o motivo real nunca saía do corpo da resposta.
    const erros = Array.isArray(obj.erros)
      ? obj.erros.filter((e: any) => typeof e === "string" && e.trim() !== "").map(String)
      : [];
    if (erros.length > 0) {
      const lista = erros.length === 1 ? erros[0] : erros.map((e) => `• ${e}`).join("\n");
      return base ? `${base}\n\n${lista}` : lista;
    }

    return base || (obj.bloqueado != null ? `Bloqueado: ${obj.bloqueado}` : "");
  };

  const raiz = mensagemDe(corpo);

  let detalhe: any = null;
  if (corpo?.cliente_resultado && typeof corpo.cliente_resultado === "object") {
    detalhe = corpo.cliente_resultado;
  } else if (corpo?.contrato?.resultado && typeof corpo.contrato.resultado === "object") {
    detalhe = corpo.contrato.resultado;
  } else if (corpo?.detalhe && typeof corpo.detalhe === "object") {
    detalhe = corpo.detalhe;
  } else if (
    corpo?.cliente_resultado?.resultado &&
    typeof corpo.cliente_resultado.resultado === "object"
  ) {
    detalhe = corpo.cliente_resultado.resultado;
  }

  const detalheMsg = mensagemDe(detalhe);

  let msg = "";
  if (raiz && detalheMsg && raiz !== detalheMsg) {
    msg = `${raiz}\n\nMotivo: ${detalheMsg}`;
  } else if (raiz || detalheMsg) {
    msg = raiz || detalheMsg;
  }

  const candidatos =
    Array.isArray(corpo?.candidatos) && corpo.candidatos.length > 0
      ? corpo.candidatos
      : Array.isArray(detalhe?.candidatos) && detalhe.candidatos.length > 0
      ? detalhe.candidatos
      : [];

  if (candidatos.length > 0) {
    const lines = candidatos
      .filter((c: any) => c && typeof c === "object")
      .map(
        (c: any) =>
          `\u2022 ${c?.razao_social ?? "(sem razão social)"} \u2014 c\u00f3digo ${c?.codigo_cliente_omie ?? "\u2014"}`
      )
      .join("\n");
    if (lines) {
      msg = `${msg}\n\nCadastros encontrados no Omie:\n${lines}`;
    }
  }

  return msg;
}

// Extrai o array de candidatos de um cnpj_ambiguo_no_omie, procurando nos
// mesmos lugares onde extrairMensagemErro busca o detalhe da resposta.
function extrairCandidatos(corpo: any): any[] {
  if (corpo == null) return [];

  let detalhe: any = null;
  if (corpo?.cliente_resultado && typeof corpo.cliente_resultado === "object") {
    detalhe = corpo.cliente_resultado;
  } else if (corpo?.contrato?.resultado && typeof corpo.contrato.resultado === "object") {
    detalhe = corpo.contrato.resultado;
  } else if (corpo?.detalhe && typeof corpo.detalhe === "object") {
    detalhe = corpo.detalhe;
  } else if (
    corpo?.cliente_resultado?.resultado &&
    typeof corpo.cliente_resultado.resultado === "object"
  ) {
    detalhe = corpo.cliente_resultado.resultado;
  }

  const candidatos =
    Array.isArray(corpo?.candidatos) && corpo.candidatos.length > 0
      ? corpo.candidatos
      : Array.isArray(detalhe?.candidatos) && detalhe.candidatos.length > 0
      ? detalhe.candidatos
      : [];

  return candidatos.filter((c: any) => c && typeof c === "object");
}

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
  clienteId,
}: {
  tenantId: string;
  contrato: ContratoAtivo;
  clienteId: string;
}) {
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bloqueioOpen, setBloqueioOpen] = useState(false);
  const [bloqueioMsg, setBloqueioMsg] = useState<string>("");
  const [dryRun, setDryRun] = useState<any | null>(null);
  const [candidatos, setCandidatos] = useState<any[]>([]);
  const [vinculando, setVinculando] = useState<number | string | null>(null);

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
        // A função responde bloqueio com 4xx, e o supabase-js descarta o corpo em não-2xx: sobrava
        // "Falha ao preparar o envio", que já mascarou um 403 de head antes (ver v12 do
        // omie-integration-call) e mascarou o bloqueio de data de corte agora. O corpo segue
        // acessível em error.context — bloqueio vai para o mesmo diálogo do caminho 200.
        let corpo: any = null;
        try {
          corpo = await (error as any)?.context?.json?.();
        } catch {
          /* corpo não era JSON */
        }
        if (corpo?.bloqueado || corpo?.error) {
          setCandidatos(extrairCandidatos(corpo));
          setBloqueioMsg(extrairMensagemErro(corpo));
          setBloqueioOpen(true);
        } else {
          toast.error("Falha ao preparar o envio. Tente novamente.");
        }
        return;
      }
      if (data?.ok === false) {
        setCandidatos(extrairCandidatos(data));
        setBloqueioMsg(extrairMensagemErro(data));
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
        let body: any = {};
        try {
          body = await error?.context?.json?.() ?? {};
        } catch {
          toast.error("Falha ao enviar ao Omie. Tente novamente.");
          return;
        }
        const msg = extrairMensagemErro(body);
        if (!msg) {
          toast.error("Falha ao enviar ao Omie. Tente novamente.");
          return;
        }
        setConfirmOpen(false);
        setCandidatos(extrairCandidatos(body));
        setBloqueioMsg(msg);
        setBloqueioOpen(true);
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
      const msg = extrairMensagemErro(data);
      setConfirmOpen(false);
      setCandidatos(extrairCandidatos(data));
      setBloqueioMsg(msg);
      setBloqueioOpen(true);

    } catch {
      toast.error("Falha ao enviar ao Omie. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const handleVincular = async (candidato: any) => {
    const codigo = candidato?.codigo_cliente_omie;
    const razao = candidato?.razao_social ?? "(sem razão social)";
    const ok = window.confirm(
      `Vincular este cliente ao cadastro ${razao} (código ${codigo}) no Omie?\n` +
        "Isso define para onde todas as futuras sincronizações deste cliente vão."
    );
    if (!ok) return;

    setVinculando(codigo);
    try {
      const { data, error } = await supabase.functions.invoke("omie-integration-call", {
        body: {
          acao: "salvar_vinculo",
          tenant_id: tenantId,
          // Conta Omie sai do cliente (cliente -> unidade -> conta). Ver resolverConta v16.
          cliente_id: clienteId,
          dados: {
            tipo: "cliente",
            ds_customer_id: clienteId,
            omie_customer_id: candidato.codigo_cliente_omie,
            origem: "dialog_envio_omie",
          },
        },
      });

      if (error) {
        let body: any = {};
        try {
          body = (await error?.context?.json?.()) ?? {};
        } catch {
          body = {};
        }
        const msg = extrairMensagemErro(body);
        setBloqueioMsg(msg || "Falha ao vincular o cadastro no Omie. Tente novamente.");
        return;
      }
      if (data?.ok === false) {
        const msg = extrairMensagemErro(data);
        setBloqueioMsg(msg || "Falha ao vincular o cadastro no Omie. Tente novamente.");
        return;
      }

      setBloqueioOpen(false);
      setCandidatos([]);
      toast.success(`Cliente vinculado ao cadastro ${codigo}. Enviando...`);
      handleConfirm();
    } catch {
      setBloqueioMsg("Falha ao vincular o cadastro no Omie. Tente novamente.");
    } finally {
      setVinculando(null);
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

      <AlertDialog
        open={bloqueioOpen}
        onOpenChange={(v) => {
          if (vinculando != null) return;
          setBloqueioOpen(v);
          if (!v) setCandidatos([]);
        }}
      >
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

          {candidatos.length >= 2 && (
            <div className="space-y-3">
              <div className="text-sm font-medium">
                Escolha a qual cadastro do Omie este cliente pertence:
              </div>
              <div className="space-y-2">
                {candidatos.map((c, i) => {
                  const codigo = c?.codigo_cliente_omie;
                  const inativo = c?.inativo === "S";
                  const esteVinculando = vinculando === codigo;
                  return (
                    <div
                      key={`${codigo ?? "sem-codigo"}-${i}`}
                      className="flex items-center justify-between gap-3 border rounded-md p-3 flex-wrap"
                    >
                      <div className="text-sm min-w-0">
                        <div className="font-medium flex items-center gap-2">
                          {c?.razao_social ?? "(sem razão social)"}
                          {inativo && (
                            <Badge
                              variant="outline"
                              className="text-amber-700 border-amber-300 dark:text-amber-400 dark:border-amber-900"
                            >
                              inativo no Omie
                            </Badge>
                          )}
                        </div>
                        <div className="text-muted-foreground font-mono text-xs">
                          código {codigo ?? "—"}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleVincular(c)}
                        disabled={vinculando != null}
                      >
                        {esteVinculando && (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        )}
                        Vincular a este
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogAction disabled={vinculando != null}>Entendi</AlertDialogAction>
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

  // A conta Omie vem da UNIDADE DO CLIENTE, não do tenant: com duas contas, o .maybeSingle()
  // por tenant erra ("multiple rows returned"), a query falha e o card some da tela.
  const contaOmieQuery = useOmieContaDoCliente(clienteId);
  const integracaoAtivaQuery = { data: contaOmieQuery.data?.ativo === true, isLoading: contaOmieQuery.isLoading };

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
            <EnviarBotao tenantId={tid} contrato={contratos[0]} clienteId={clienteId} />
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
                <EnviarBotao tenantId={tid} contrato={c} clienteId={clienteId} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
