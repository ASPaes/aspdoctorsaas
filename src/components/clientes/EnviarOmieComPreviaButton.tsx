import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mapaVinculoOmie } from "@/lib/omieVinculo";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Send, Loader2, AlertTriangle, CheckCircle } from "lucide-react";

/**
 * Botão "Enviar ao Omie" com PRÉ-VISUALIZAÇÃO: dry_run → confirmação → criar.
 *
 * Estava embutido no IntegracaoOmieCard. Saiu para cá porque o diálogo de fim do cadastro de
 * produto (ClienteProdutosSection) promete pré-visualização na tela — "mostramos primeiro um
 * resumo do que será criado" — e usava o outro botão, o EnviarContratoOmieButton, que empurra
 * direto para a fila, sem resumo nenhum. Além de mentir, o caminho da fila só mostra o motivo da
 * recusa no `title` do botão: na tela sobrava "Inválido — tentar novamente" e o motivo real
 * chegava por WhatsApp, minutos depois (CT-2026-5685, 14/08/2026 — "Cliente sem razao social
 * cadastrada", com o campo vazio de verdade no banco naquele instante).
 *
 * Aqui o bloqueio vem no corpo da resposta e vira diálogo legível, com o motivo por extenso.
 */

export type ContratoParaEnvioOmie = {
  id: string;
  numero: string | null;
  /** Já casado no Omie? Nesse caso o botão vira selo e não há o que enviar. */
  sincronizado: boolean;
  codigo_contrato_omie: string | number | null;
};

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

export function extrairMensagemErro(corpo: any): string {
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

    // `detalhe_omie` é a faultstring que o Omie devolveu, e é o único lugar onde o motivo real
    // existe: o `error` do ds-omie-contrato-criar é sempre o mesmo texto genérico ("Falha ao criar
    // o contrato no Omie."). Sem ler este campo, a tela mostrava só a frase genérica e não havia o
    // que fazer com ela — contrato 2026-5700 (20/08/2026) foi recusado por "É obrigatório informar
    // o valor unitário do item, tag [valorUnit]" (MRR do cliente zerado) e nada disso apareceu.
    const omie =
      typeof obj.detalhe_omie === "string" && obj.detalhe_omie.trim() !== ""
        ? `Resposta do Omie: ${obj.detalhe_omie.trim()}`
        : "";

    const partes: string[] = [];
    if (base) partes.push(base);
    if (erros.length > 0) {
      partes.push(erros.length === 1 ? erros[0] : erros.map((e) => `• ${e}`).join("\n"));
    }
    if (omie) partes.push(omie);

    if (partes.length === 0) {
      return obj.bloqueado != null ? `Bloqueado: ${obj.bloqueado}` : "";
    }
    return partes.join("\n\n");
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
          `• ${c?.razao_social ?? "(sem razão social)"} — código ${c?.codigo_cliente_omie ?? "—"}`
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
export function extrairCandidatos(corpo: any): any[] {
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

export function SincronizadoBadge({ codigo }: { codigo: string | number | null }) {
  return (
    <Badge
      variant="outline"
      className="gap-1 text-emerald-700 border-emerald-300 dark:text-emerald-400 dark:border-emerald-900"
    >
      <CheckCircle className="h-3 w-3" />
      Sincronizado com o Omie
      {codigo != null && <span className="ml-1 font-mono text-[11px]">({codigo})</span>}
    </Badge>
  );
}

export default function EnviarOmieComPreviaButton({
  tenantId,
  contrato,
  clienteId,
  onEnviado,
  codigosOmieDoCliente,
}: {
  tenantId: string;
  contrato: ContratoParaEnvioOmie;
  clienteId: string;
  /** Chamado após o envio dar certo — para a tela de origem revalidar o que mostra. */
  onEnviado?: (omieContractId: string | number | null) => void;
  /**
   * Contratos do Omie que os OUTROS contratos deste cliente já ocupam. Serve para, num CNPJ com
   * cadastro duplicado no Omie, apontar qual dos cadastros já é o do cliente.
   *
   * Vem de fora de propósito: quem chama já calculou isso para decidir o selo "Sincronizado" de
   * cada contrato. A versão anterior refazia a conta aqui, com duas consultas cujo erro eu não
   * checava — quando não respondiam, o refinamento sumia sem dizer nada.
   */
  codigosOmieDoCliente?: (string | number)[];
}) {
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bloqueioOpen, setBloqueioOpen] = useState(false);
  const [bloqueioMsg, setBloqueioMsg] = useState<string>("");
  const [dryRun, setDryRun] = useState<any | null>(null);
  const [candidatos, setCandidatos] = useState<any[]>([]);
  const [vinculando, setVinculando] = useState<number | string | null>(null);
  // Trava de data de ativação dispensável: o backend responde dispensavel:true SÓ nessa, com as
  // duas datas. Documento inválido e contrato sem modelo não têm "enviar mesmo assim", de propósito.
  const [dispensa, setDispensa] = useState<{ data_do_contrato?: string; data_de_corte?: string } | null>(null);
  const [dispensaCiente, setDispensaCiente] = useState(false);
  // Guarda a dispensa entre o dry_run e o criar: a decisão é tomada uma vez, no diálogo de
  // bloqueio, e vale para as duas chamadas seguintes. O backend não persiste nada.
  // Fica AQUI, com os outros hooks: mais abaixo há um early return (contrato.sincronizado), e um
  // useState depois dele muda a contagem de hooks entre renders.
  const [corteDispensado, setCorteDispensado] = useState(false);
  // Confirmação inline do "Vincular a este": era window.confirm, destoando de todo o resto e sem
  // dizer a consequência inteira. Inline em vez de outro AlertDialog para não aninhar diálogo.
  const [confirmandoVinculo, setConfirmandoVinculo] = useState<number | string | null>(null);

  // NUMEROS, não strings: omie_espelho_cadastro.codigo_cliente_omie é `number` no schema, e o
  // .in() com strings não casou — a primeira versão desta tela ficou muda por isso.
  const codigosCandidatos = candidatos
    .map((c) => Number(c?.codigo_cliente_omie))
    .filter((v) => Number.isFinite(v));

  // Qual dos cadastros duplicados do Omie já é o "de casa" deste cliente.
  //
  // Sem isto a escolha é às cegas: os candidatos aparecem com a MESMA razão social e só diferem
  // pelo código, e escolher o errado cria o contrato num cadastro separado dos outros — o cliente
  // fica partido em dois no Omie, cada metade com uma parte da cobrança. VALEMAR, 27/08/2026: dois
  // contratos já vinculados no 7248327517 e o terceiro sendo criado, com o 7248327513 vazio ao lado.
  const ocupadosPeloCliente = new Set((codigosOmieDoCliente ?? []).map(String));

  type InfoCadastro = { contratos: string[]; doCliente: string[] };
  const {
    data: infoCadastros,
    isLoading: infoLoading,
    error: infoErro,
  } = useQuery<Record<string, InfoCadastro>>({
    queryKey: [
      "omie-cadastro-em-uso",
      tenantId,
      clienteId,
      codigosCandidatos.join(","),
      [...ocupadosPeloCliente].sort().join(","),
    ],
    enabled: codigosCandidatos.length >= 2 && !!clienteId,
    queryFn: async () => {
      // O que cada cadastro duplicado tem de contrato no Omie. Esta parte sozinha já desempata a
      // escolha, e depende de UMA tabela só — de propósito: a versão anterior cruzava três e,
      // quando qualquer uma não respondia, a tela ficava muda, indistinguível de "nenhum em uso".
      const { data: esp, error: eEsp } = await (supabase.from("omie_espelho_cadastro") as any)
        .select("codigo_cliente_omie, codigo_contrato_omie, contratos_omie")
        .in("codigo_cliente_omie", codigosCandidatos);
      if (eEsp) throw eEsp;

      const info: Record<string, InfoCadastro> = {};
      for (const e of (esp ?? []) as any[]) {
        const lista = Array.isArray(e.contratos_omie)
          ? e.contratos_omie.map((c: any) => String(c?.codigo_contrato_omie)).filter(Boolean)
          : [];
        if (e.codigo_contrato_omie != null && !lista.includes(String(e.codigo_contrato_omie))) {
          lista.push(String(e.codigo_contrato_omie));
        }
        // O que já é deste cliente sai da prop, não de consulta nova: quem chama já tem esse dado.
        info[String(e.codigo_cliente_omie)] = {
          contratos: lista,
          doCliente: lista.filter((c) => ocupadosPeloCliente.has(c)),
        };
      }
      return info;
    },
  });
  // Enviado NESTA sessão do componente: sem isto, o botão continua dizendo "Enviar ao Omie"
  // depois do sucesso e convida a mandar de novo.
  const [enviadoAgora, setEnviadoAgora] = useState<string | number | null | undefined>(undefined);

  if (contrato.sincronizado) {
    return <SincronizadoBadge codigo={contrato.codigo_contrato_omie} />;
  }
  if (enviadoAgora !== undefined) {
    return <SincronizadoBadge codigo={enviadoAgora ?? null} />;
  }

  // Lê do corpo se ESTA trava aceita "enviar mesmo assim". Só a data de ativação devolve
  // dispensavel:true — as outras não têm saída e nem deveriam ter.
  const registrarBloqueio = (corpo: any) => {
    setCandidatos(extrairCandidatos(corpo));
    setBloqueioMsg(extrairMensagemErro(corpo));
    setDispensa(
      corpo?.dispensavel === true
        ? { data_do_contrato: corpo?.data_do_contrato, data_de_corte: corpo?.data_de_corte }
        : null,
    );
    setDispensaCiente(false);
    setBloqueioOpen(true);
  };

  const handleClick = async (dispensarCorte = false) => {
    setLoading(true);
    if (dispensarCorte) setCorteDispensado(true);
    try {
      const { data, error } = await supabase.functions.invoke("recon-omie-escrever", {
        body: {
          tenant_id: tenantId,
          ds_contract_id: contrato.id,
          modo: "dry_run",
          ...(dispensarCorte || corteDispensado ? { permitir_anterior_ao_corte: true } : {}),
        },
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
          registrarBloqueio(corpo);
        } else {
          toast.error("Falha ao preparar o envio. Tente novamente.");
        }
        return;
      }
      if (data?.ok === false) {
        registrarBloqueio(data);
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
        body: {
          tenant_id: tenantId,
          ds_contract_id: contrato.id,
          modo: "criar",
          // A dispensa vale para as duas chamadas: sem repeti-la aqui, o dry_run passaria e o
          // criar bateria na mesma trava.
          ...(corteDispensado ? { permitir_anterior_ao_corte: true } : {}),
        },
      });
      if (error) {
        let body: any = {};
        try {
          body = (await error?.context?.json?.()) ?? {};
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
        registrarBloqueio(body);
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
        setEnviadoAgora(omieId || null);
        onEnviado?.(omieId || null);
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
    // A confirmação agora é inline no card do candidato: mostra a consequência e, quando o cadastro
    // escolhido não é o que já tem os contratos deste cliente, avisa que ele fica partido em dois
    // no Omie. O window.confirm que havia aqui não dizia isso e destoava do resto da tela.
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
      setConfirmandoVinculo(null);
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
      {/* Arrow function obrigatória: onClick={handleClick} passaria o MouseEvent como
          dispensarCorte, e um evento é truthy — todo clique dispensaria a data de ativação. */}
      <Button type="button" variant="outline" size="sm" onClick={() => handleClick()} disabled={loading}>
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
                  const info = infoCadastros?.[String(codigo)];
                  const jaUsados = info?.doCliente.length ?? 0;
                  const confirmando = confirmandoVinculo != null && String(confirmandoVinculo) === String(codigo);
                  return (
                    <div
                      key={`${codigo ?? "sem-codigo"}-${i}`}
                      className={`border rounded-md p-3 ${
                        jaUsados > 0 ? "border-emerald-300 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="text-sm min-w-0">
                          <div className="font-medium flex items-center gap-2 flex-wrap">
                            {c?.razao_social ?? "(sem razão social)"}
                            {inativo && (
                              <Badge
                                variant="outline"
                                className="text-amber-700 border-amber-300 dark:text-amber-400 dark:border-amber-900"
                              >
                                inativo no Omie
                              </Badge>
                            )}
                            {jaUsados > 0 && (
                              <Badge
                                variant="outline"
                                className="text-emerald-700 border-emerald-300 dark:text-emerald-400 dark:border-emerald-900"
                              >
                                já usado por este cliente
                              </Badge>
                            )}
                          </div>
                          <div className="text-muted-foreground font-mono text-xs">
                            código {codigo ?? "—"}
                          </div>
                          {/* O sinal que decide: sem ele os dois cadastros são indistinguíveis.
                              Cada estado tem texto próprio — silêncio aqui já custou uma rodada,
                              porque "não consegui verificar" ficava igual a "nenhum em uso". */}
                          {jaUsados > 0 && (
                            <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1">
                              {jaUsados === 1
                                ? "1 contrato deste cliente já está neste cadastro."
                                : `${jaUsados} contratos deste cliente já estão neste cadastro.`}
                            </div>
                          )}
                          {jaUsados === 0 && (info?.contratos.length ?? 0) > 0 && (
                            <div className="text-[11px] text-muted-foreground mt-1">
                              {info!.contratos.length === 1
                                ? "1 contrato no Omie"
                                : `${info!.contratos.length} contratos no Omie`}
                              : <span className="font-mono">{info!.contratos.join(", ")}</span>
                            </div>
                          )}
                          {infoLoading && (
                            <div className="text-[11px] text-muted-foreground mt-1">
                              verificando os contratos deste cadastro…
                            </div>
                          )}
                          {!infoLoading && !infoErro && (info?.contratos.length ?? 0) === 0 && (
                            <div className="text-[11px] text-muted-foreground mt-1">
                              Nenhum contrato neste cadastro.
                            </div>
                          )}
                          {!!infoErro && (
                            <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
                              Não consegui verificar os contratos deste cadastro ({String(
                                (infoErro as any)?.message ?? infoErro,
                              ).slice(0, 120)}).
                            </div>
                          )}
                        </div>
                        {!confirmando && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setConfirmandoVinculo(codigo)}
                            disabled={vinculando != null}
                          >
                            {esteVinculando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Vincular a este
                          </Button>
                        )}
                      </div>

                      {confirmando && (
                        <div className="mt-2 rounded border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-2 space-y-2">
                          <div className="text-xs text-amber-800 dark:text-amber-300">
                            Este cliente passa a pertencer ao cadastro{" "}
                            <strong className="font-mono">{codigo}</strong> no Omie, e o contrato será
                            criado lá. Vale para <strong>todas</strong> as sincronizações seguintes
                            deste cliente.
                            {jaUsados === 0 && (
                              <>
                                {" "}
                                Nenhum contrato deste cliente está neste cadastro hoje: se os outros
                                estiverem no cadastro ao lado, o cliente fica dividido em dois no Omie.
                              </>
                            )}
                          </div>
                          <div className="flex gap-2 justify-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmandoVinculo(null)}
                              disabled={vinculando != null}
                            >
                              Cancelar
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="bg-amber-600 hover:bg-amber-700"
                              onClick={() => handleVincular(c)}
                              disabled={vinculando != null}
                            >
                              {esteVinculando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                              Vincular e enviar
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {dispensa && (
            <div className="space-y-2 rounded border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5">
              <div className="text-xs text-amber-800 dark:text-amber-300">
                A data de ativação é uma regra desta casa, não uma limitação do Omie: ela existe para
                a integração não levar a base antiga junto. Contrato lançado agora com data
                retroativa é caso legítimo, e você pode enviar assim mesmo.
              </div>
              <label className="flex items-start gap-2 text-xs cursor-pointer text-amber-800 dark:text-amber-300">
                <Checkbox
                  checked={dispensaCiente}
                  onCheckedChange={(v) => setDispensaCiente(v === true)}
                  className="mt-0.5"
                />
                <span>
                  Confirmo que este contrato deve ir ao Omie mesmo sendo de{" "}
                  <strong>{dispensa.data_do_contrato ?? "data anterior"}</strong>. A decisão fica
                  registrada no histórico com meu nome.
                </span>
              </label>
            </div>
          )}

          <AlertDialogFooter>
            {dispensa && (
              <Button
                type="button"
                variant="outline"
                className="border-amber-400 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40"
                disabled={!dispensaCiente || loading || vinculando != null}
                onClick={() => {
                  setBloqueioOpen(false);
                  void handleClick(true);
                }}
              >
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Enviar mesmo assim
              </Button>
            )}
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
