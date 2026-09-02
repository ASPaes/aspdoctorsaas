import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Lock, LockOpen, Power, PowerOff, TriangleAlert } from "lucide-react";

// ============================================================================
// Ativar/Desativar e Bloquear/Desbloquear a licença do cliente no OEM.
//
// Cada botão mostra o INVERSO do estado atual, porque é isso que o clique faz.
// São duas dimensões independentes: desativado não cobra, bloqueado cobra. Por
// isso são dois botões e não um seletor de estado.
//
// ---------------------------------------------------------------------------
// O CLIQUE NÃO GRAVA. ELE SIMULA PRIMEIRO.
// ---------------------------------------------------------------------------
// A rota do parceiro salva a FILIAL INTEIRA: o que não vai no corpo some da
// licença. Por isso o primeiro passo é `simular: true`, que lê a licença no
// parceiro e devolve o estado que ele tem AGORA sem enviar nada. A confirmação
// mostra esse estado, e o botão de gravar só existe quando a leitura veio
// completa. Se faltar campo, a tela diz qual e não deixa gravar.
//
// Isso não é excesso de zelo: o espelho desta tela é uma cópia atualizada de 6
// em 6 horas, e a licença pode ter mudado no portal desde então. Confirmar em
// cima do espelho seria confirmar em cima de um número velho.
//
// ---------------------------------------------------------------------------
// "NÃO DEU PARA CONFIRMAR" NÃO É "FALHOU"
// ---------------------------------------------------------------------------
// Depois de gravar, a função relê a licença até 3 vezes. A releitura do parceiro
// atrasa, e não de forma constante (medido em 28/08/2026). Quando ela não bate,
// a tela avisa em âmbar e manda conferir no portal, em vez de dizer que deu
// errado uma escrita que o parceiro aceitou.
// ============================================================================

type Licenca = {
  id: string;
  filial_codigo: string | null;
  razao_oem: string | null;
  status_oem: string | null;
  bloqueado_oem: boolean | null;
  desativa_em: string | null;
};

type Acao = "ativar" | "desativar" | "bloquear" | "desbloquear";

type Simulacao = {
  pode_gravar: boolean;
  faltando: string[];
  sem_mudanca: boolean;
  antes: { bloqueado: boolean | null; desativado: boolean | null; baixa_em?: string | null } | null;
  depois: { bloqueado: boolean | null; desativado: boolean | null } | null;
  campos_vistos?: unknown;
};

// ⚠️ DESATIVAR NÃO DESLIGA NA HORA, e o texto tem que dizer isso. Medido em
// 01/09/2026 na Pizzaria Beda: o OEM aceitou, marcou "Desativa em: 30/09/2026"
// no portal e manteve a licença ativa. Prometer que o cliente perde o acesso
// agora faria alguém desativar achando que resolveu o caso do dia.
const TEXTO: Record<Acao, { titulo: string; efeito: string }> = {
  ativar: {
    titulo: "Ativar a licença no OEM?",
    efeito: "A licença volta ao ar no parceiro e volta a entrar na cobrança dele.",
  },
  desativar: {
    titulo: "Desativar a licença no OEM?",
    efeito: "O OEM marca a baixa para o fim do mês de cobrança, não desliga agora. Até a data marcada a licença fica de pé e continua sendo cobrada pelo parceiro.",
  },
  bloquear: {
    titulo: "Bloquear a licença no OEM?",
    efeito: "O cliente perde o acesso ao sistema na hora. A licença continua ativa e continua sendo cobrada pelo parceiro.",
  },
  desbloquear: {
    titulo: "Desbloquear a licença no OEM?",
    efeito: "O cliente volta a ter acesso ao sistema.",
  },
};

/** A recusa da edge function vem no corpo, não na mensagem do erro do client. */
async function mensagemDoErro(error: any): Promise<string | null> {
  const detalhe = error?.context?.body ?? null;
  if (!detalhe) return null;
  try {
    const texto = typeof detalhe === "string" ? detalhe : await new Response(detalhe).text();
    return JSON.parse(texto)?.mensagem ?? null;
  } catch {
    return null;
  }
}

async function chamar(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("oem-licenca-estado", { body });
  if (error) throw new Error((await mensagemDoErro(error)) ?? error.message);
  if (data?.ok === false) throw new Error(data?.mensagem ?? "O OEM recusou a alteração.");
  return data;
}

const sim = (v: boolean | null | undefined) => (v === true ? "Sim" : v === false ? "Não" : "sem leitura");
const dataBR = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
// O "hoje" da operação, não o do navegador em UTC: às 21h de 30/09 no Brasil o
// UTC já é 01/10 e uma baixa marcada para hoje apareceria como vencida.
const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

export default function OemLicencaEstadoBotoes({
  clienteId, licenca,
}: { clienteId: string; licenca: Licenca }) {
  const { can } = usePermissions();
  const qc = useQueryClient();
  const [acao, setAcao] = useState<Acao | null>(null);
  const [simulacao, setSimulacao] = useState<Simulacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Mesma chave dos módulos: quem pode mexer nos módulos do cliente pode ligar
  // e desligar a licença. A edge function confere de novo por dentro (a tela é
  // conveniência, não portão). O `return null` fica LÁ EMBAIXO, depois dos
  // hooks: sair antes deles quebra a ordem de hooks entre um render e outro.
  const podeMexer = can("clientes.modulos", "view");

  const desativado =
    licenca.status_oem === "Desativado" ? true : licenca.status_oem === "Ativo" ? false : null;
  const bloqueado = licenca.bloqueado_oem;

  // TRÊS ESTADOS, NÃO DOIS. Entre "ativa" e "desativada" existe "ativa com
  // baixa marcada": o OEM não desliga na hora, agenda para o fim do mês. Sem
  // reconhecer esse meio, a licença que acabou de receber a baixa continuava
  // oferecendo "Desativar" e não havia como desfazer pela tela.
  const baixaMarcada = !!licenca.desativa_em && licenca.desativa_em >= hojeSP() && desativado === false;
  // Ativar serve para os dois: religar a que caiu e cancelar a baixa da que
  // ainda está de pé. Nos dois casos o pedido ao parceiro é o mesmo.
  const acaoEstado: Acao = desativado || baixaMarcada ? "ativar" : "desativar";

  const simulacaoMut = useMutation({
    mutationFn: (a: Acao) => chamar({ recon_id: licenca.id, cliente_id: clienteId, acao: a, simular: true }),
    onSuccess: (d) => setSimulacao(d as Simulacao),
    onError: (e: any) => setErro(e?.message ?? String(e)),
  });

  const gravarMut = useMutation({
    mutationFn: (a: Acao) => chamar({ recon_id: licenca.id, cliente_id: clienteId, acao: a }),
    onSuccess: async (d: any) => {
      fechar();
      // `confirmado !== true` não é falha: é a releitura do parceiro atrasando.
      // O aviso âmbar manda conferir no portal em vez de dizer que deu errado.
      toast(
        d?.sem_mudanca
          ? { title: "A licença já estava nesse estado", description: d?.mensagem ?? "Nada foi enviado ao OEM." }
          : d?.confirmado === true && d?.baixa_em
            // Desativação é AGENDADA. Dizer "desativada" aqui contradiria o
            // portal do parceiro, que segue mostrando a licença de pé até a data.
            ? {
                title: `Baixa marcada para ${dataBR(d.baixa_em)}`,
                description: "O OEM não desliga na hora: a licença fica de pé e continua sendo cobrada até essa data.",
              }
          : d?.confirmado === true
            ? { title: "Licença alterada no OEM", description: "O parceiro confirmou o novo estado." }
            : {
                title: "Enviado ao OEM, sem confirmação ainda",
                description:
                  "O parceiro aceitou, mas a releitura ainda mostra o estado anterior. Isso costuma ser atraso da API dele. Confira no portal do OEM se o estado não mudar aqui na próxima atualização do espelho.",
              },
      );
      await qc.invalidateQueries({ queryKey: ["oem-licencas-cliente"] });
    },
    onError: (e: any) => setErro(e?.message ?? String(e)),
  });

  function abrir(a: Acao) {
    setAcao(a);
    setSimulacao(null);
    setErro(null);
    simulacaoMut.mutate(a);
  }

  function fechar() {
    setAcao(null);
    setSimulacao(null);
    setErro(null);
  }

  const lendo = simulacaoMut.isPending;
  const gravando = gravarMut.isPending;
  const podeConfirmar = !!simulacao?.pode_gravar && !simulacao?.sem_mudanca && !erro;

  if (!podeMexer) return null;

  return (
    <>
      <div className="flex items-center gap-1.5">
        {/* Ativar/Desativar. `null` é o OEM não ter respondido esta filial na
            última leitura: sem saber o estado, não há inverso para oferecer. */}
        <Button
          size="sm"
          variant="outline"
          className={
            "h-7 px-2.5 text-xs gap-1.5 " +
            (acaoEstado === "ativar"
              ? "text-emerald-600 dark:text-emerald-400 hover:text-emerald-600"
              : "text-muted-foreground")
          }
          disabled={desativado === null || gravando}
          title={
            desativado === null
              ? "O OEM não informou o status desta licença na última leitura."
              : baixaMarcada
                ? `Baixa marcada para ${dataBR(licenca.desativa_em!)}. Ativar cancela a baixa.`
                : undefined
          }
          onClick={() => abrir(acaoEstado)}
        >
          {acaoEstado === "ativar" ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
          {acaoEstado === "ativar" ? "Ativar" : "Desativar"}
        </Button>

        <Button
          size="sm"
          variant="outline"
          className={
            "h-7 px-2.5 text-xs gap-1.5 " +
            (bloqueado === true ? "text-emerald-600 dark:text-emerald-400 hover:text-emerald-600" : "text-muted-foreground")
          }
          disabled={bloqueado === null || bloqueado === undefined || gravando}
          title={bloqueado === null ? "O OEM não informou o bloqueio desta licença na última leitura." : undefined}
          onClick={() => abrir(bloqueado ? "desbloquear" : "bloquear")}
        >
          {bloqueado ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
          {bloqueado ? "Desbloquear" : "Bloquear"}
        </Button>
      </div>

      <Dialog open={!!acao} onOpenChange={(o) => !o && !gravando && fechar()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{acao ? TEXTO[acao].titulo : ""}</DialogTitle>
            <DialogDescription>
              {licenca.razao_oem ?? `Filial ${licenca.filial_codigo}`} · filial {licenca.filial_codigo}
            </DialogDescription>
          </DialogHeader>

          {lendo && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Lendo o estado atual da licença no OEM...
            </div>
          )}

          {erro && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {erro}
            </div>
          )}

          {!lendo && !erro && simulacao && (
            <div className="space-y-3">
              {/* O estado LIDO AGORA no parceiro, não o do espelho. É a diferença
                  entre confirmar sobre o dado de verdade e sobre uma cópia de
                  até 6 horas atrás. */}
              <div className="rounded-md border divide-y text-sm">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-muted-foreground text-xs uppercase tracking-wide">
                    Agora no OEM
                  </span>
                  <span className="tabular-nums">
                    Desativada: <strong>{sim(simulacao.antes?.desativado)}</strong>
                    {/* A baixa marcada é a terceira informação do estado: sem
                        ela, "Desativada: Não" mente para uma licença que cai
                        no fim do mês. */}
                    {simulacao.antes?.baixa_em && (
                      <> <span className="text-amber-600 dark:text-amber-400">
                        (baixa em <strong>{dataBR(simulacao.antes.baixa_em)}</strong>)
                      </span></>
                    )}{" "}
                    · Bloqueada: <strong>{sim(simulacao.antes?.bloqueado)}</strong>
                  </span>
                </div>
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-muted-foreground text-xs uppercase tracking-wide">
                    Depois do clique
                  </span>
                  <span className="tabular-nums">
                    Desativada: <strong>{sim(simulacao.depois?.desativado)}</strong> · Bloqueada:{" "}
                    <strong>{sim(simulacao.depois?.bloqueado)}</strong>
                  </span>
                </div>
              </div>

              {simulacao.sem_mudanca && (
                <p className="text-sm text-muted-foreground">
                  {simulacao.antes?.baixa_em && acao === "desativar"
                    ? `A baixa desta licença já está marcada para ${dataBR(simulacao.antes.baixa_em)} no OEM. Nada será enviado.`
                    : "A licença já está nesse estado no OEM. Nada será enviado."}
                </p>
              )}

              {/* A leitura veio sem os campos de estado. Gravar assim decidiria
                  por conta própria se a licença fica ligada, então não há botão
                  de confirmar. */}
              {!simulacao.pode_gravar && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive space-y-1">
                  <p className="font-medium flex items-center gap-1.5">
                    <TriangleAlert className="h-4 w-4" /> A leitura da licença veio incompleta
                  </p>
                  <p>
                    O OEM não devolveu {simulacao.faltando?.join(" nem ") || "os campos de estado"}. Como a
                    gravação salva a licença inteira, enviar assim decidiria sozinho se ela fica ligada.
                    Nada foi enviado.
                  </p>
                </div>
              )}

              {simulacao.pode_gravar && !simulacao.sem_mudanca && acao && (
                <p className="text-sm text-muted-foreground">
                  {acao === "ativar" && simulacao.antes?.baixa_em && simulacao.antes?.desativado === false
                    ? `Cancela a baixa marcada para ${dataBR(simulacao.antes.baixa_em)}. A licença passa a valer sem prazo.`
                    : TEXTO[acao].efeito}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={fechar} disabled={gravando}>
              {podeConfirmar ? "Cancelar" : "Fechar"}
            </Button>
            {podeConfirmar && acao && (
              <Button
                variant={acao === "desativar" || acao === "bloquear" ? "destructive" : "default"}
                disabled={gravando}
                onClick={() => gravarMut.mutate(acao)}
              >
                {gravando && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {acao === "ativar" ? "Ativar" : acao === "desativar" ? "Desativar"
                  : acao === "bloquear" ? "Bloquear" : "Desbloquear"} no OEM
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
