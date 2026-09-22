import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOmieConta } from "./OmieContaContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCw, Clock, Pause, TestTube2, ExternalLink, RotateCw, Loader2, Trash2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useLinhaDestacada, CLASSE_DESTAQUE } from "@/hooks/useDeepLinkIntegracao";

type ReprocessarResp = {
  ok?: boolean;
  acao?: string;
  mensagem?: string;
  erro?: string;
  aviso?: string;
  revalidou?: boolean;
  motivos?: string[];
};

/**
 * Pergunta ao Omie, ANTES de reenfileirar, se a causa realmente saiu do caminho.
 *
 * Por que isto existe: o omie_fila_reprocessar revalida chamando montar_payload_contrato_omie,
 * que só enxerga o lado DS. Os três bloqueios que mais matam linha — troca_de_produto,
 * sem_depara e depara_aponta_cancelado — são decididos no ds-omie-contrato-alterar, no projeto
 * DoctorOMIE, e passavam batido. Efeito medido na DEM-0237: a linha do LANCHES PEREIRA E SILVA
 * (bloqueio:troca_de_produto) voltava para 'pendente', tomava o mesmo bloqueio ~2min depois e
 * voltava para 'invalido'. O botão parecia agir e não agia — loop manual sem fim.
 *
 * O dry_run já existia inteiro no omie-integration-call (acao criar_cliente_contrato): ele não
 * escreve nada no Omie e devolve o `bloqueado` real do momento. Só faltava alguém perguntar.
 */
async function conferirBloqueioAtual(
  contratoId: string,
  tenantId: string | null | undefined
): Promise<{ bloqueado: string | null; mensagem: string | null; precisaCriar: boolean }> {
  const ler = (b: any) => ({
    bloqueado: (b?.bloqueado as string) ?? null,
    mensagem:
      (b?.error as string) ??
      (Array.isArray(b?.erros) && b.erros.length ? b.erros.join("\n• ") : null),
    precisaCriar: b?.operacao === "criar",
  });
  try {
    const { data, error } = await supabase.functions.invoke("omie-integration-call", {
      // tenant_id é obrigatório aqui: a função resolve o tenant pelo PERFIL de quem chama e só
      // aceita outro se for super admin. Sem ele, o super admin simulando um tenant consultaria
      // a chave Omie da ASP contra um contrato que não é dela.
      body: {
        acao: "criar_cliente_contrato",
        modo: "dry_run",
        contrato_id: contratoId,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
    });
    if (error) {
      // 409 (bloqueado) e 422 (validação) chegam aqui; o motivo real está no corpo.
      const corpo = await (error as any)?.context?.json?.().catch(() => null);
      if (corpo) return ler(corpo);
      // Não deu para saber: não inventa bloqueio, deixa o fluxo normal seguir.
      return { bloqueado: null, mensagem: null, precisaCriar: false };
    }
    return ler(data);
  } catch {
    return { bloqueado: null, mensagem: null, precisaCriar: false };
  }
}

function ReprocessarButton({
  filaId,
  contratoId,
  tenantId,
  onDone,
}: {
  filaId: string;
  contratoId?: string | null;
  tenantId: string | null | undefined;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const handle = async () => {
    setLoading(true);
    try {
      // 1) A causa saiu do caminho? Se não, não reenfileira — e diz o porquê de verdade.
      if (contratoId) {
        const chk = await conferirBloqueioAtual(contratoId, tenantId);
        if (chk.bloqueado) {
          toast.warning("Reprocessar não vai resolver: a causa continua ativa no Omie.", {
            description: chk.mensagem ?? "O Omie ainda recusa esta alteração.",
            duration: 12000,
          });
          return;
        }
        if (chk.precisaCriar) {
          toast.warning("Este contrato ainda não existe no Omie.", {
            description:
              "A fila automática nunca cria contrato — só altera o que já está vinculado. " +
              "Vincule na Conferência ou use “Enviar ao Omie” na tela do cliente.",
            duration: 12000,
          });
          return;
        }
      }

      const { data, error } = await (supabase.rpc as any)("omie_fila_reprocessar", { p_fila_id: filaId });
      if (error) {
        toast.error("Falha ao reprocessar. Tente novamente.");
        return;
      }
      const r = (data ?? {}) as ReprocessarResp;
      if (r.ok) {
        toast.success(r.mensagem ?? (r.acao === "absorvido" ? "Item absorvido em outro da fila." : "Item devolvido para a fila."));
        if (r.aviso) toast.warning(r.aviso);
        onDone();
        return;
      }
      if (r.revalidou === false) {
        const motivos = Array.isArray(r.motivos) && r.motivos.length ? r.motivos.join("\n• ") : "Sem detalhes.";
        toast.warning("A causa ainda não foi resolvida.", { description: `• ${motivos}` });
        return;
      }
      toast.error(r.erro ?? "Não foi possível reprocessar.");
    } catch {
      toast.error("Falha ao reprocessar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="secondary" className="gap-1 shrink-0" onClick={handle} disabled={loading}>
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
            {loading ? "Conferindo…" : "Reprocessar"}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Confere no Omie se a causa saiu do caminho e, só então, devolve o item para a fila.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Tira da fila uma linha que não tem o que corrigir: contrato apagado no DoctorSaaS, alteração
 * que envelheceu e não será reenviada, ou contrato sem de/para que não vai ao Omie (`ignorado`).
 * Nada foi escrito no Omie nesses casos — é limpeza.
 * O gate de quais linhas podem sair mora na RPC, não aqui.
 */
function DescartarButton({ filaId, onDone }: { filaId: string; onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const handle = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase.rpc as any)("omie_fila_descartar", { p_fila_id: filaId });
      if (error) {
        toast.error("Não foi possível descartar.", { description: error.message });
        return;
      }
      const r = (data ?? {}) as { ok?: boolean; erro?: string };
      if (!r.ok) {
        toast.warning(r.erro ?? "Esta linha não pode ser descartada.");
        return;
      }
      toast.success("Linha removida da fila.");
      onDone();
    } catch {
      toast.error("Não foi possível descartar.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <Button size="sm" variant="ghost" className="gap-1 shrink-0" onClick={handle} disabled={loading}>
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
      Descartar
    </Button>
  );
}

type FilaItem = {
  prio?: string | number | null;
  fila_id?: string | null;
  cliente_id?: string | null;
  contrato_id?: string | null;
  cliente?: string | null;
  cnpj?: string | null;
  // A RPC já devolvia este campo e a tela ignorava.
  contrato_removido?: boolean | null;
  // Um envio POSTERIOR do mesmo contrato já chegou ao Omie: esta linha é rastro, não pendência.
  superada?: boolean | null;
  origem?: string | null;
  status?: string | null;
  tentativas?: number | null;
  enfileirado_em?: string | null;
  processado_em?: string | null;
  proxima_tentativa_em?: string | null;
  motivo?: string | null;
};

type OkRecente = {
  cliente?: string | null;
  origem?: string | null;
  processado_em?: string | null;
};

type Saude = {
  sync_ativo?: boolean | null;
  pausado?: boolean | null;
  modo_teste?: boolean | null;
  bloqueado_ate?: string | null;
  cron_ultima?: string | null;
  cron_saudavel?: boolean | null;
};

type FilaStatus = {
  gerado_em?: string | null;
  saude?: Saude | null;
  resumo?: Record<string, number> | null;
  itens?: FilaItem[] | null;
  ok_recentes?: OkRecente[] | null;
};

const ORIGEM_LABEL: Record<string, string> = {
  reajuste: "Reajuste",
  estorno_reajuste: "Estorno de reajuste",
  movimento_upsell: "Upsell",
  movimento_downsell: "Downsell",
  movimento_cross_sell: "Cross-sell",
  churn: "Cancelamento",
  reativacao: "Reativação",
  cadastro: "Alteração cadastral",
  // Origens que já existem em produção e vinham caindo no fallback, aparecendo cruas na tela.
  observacao: "Observação",
  manual: "Envio manual",
  movimento_reajuste: "Reajuste",
  valor: "Alteração de valor",
  produto: "Troca de produto",
};

function labelOrigem(o?: string | null) {
  if (!o) return "—";
  return ORIGEM_LABEL[o] ?? o;
}

function formatCNPJ(v?: string | null): string {
  if (!v) return "";
  const d = String(v).replace(/\D/g, "");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return v;
}

function formatDateTime(v?: string | null): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("pt-BR");
  } catch {
    return v;
  }
}

function relativeTime(v?: string | null): string {
  if (!v) return "—";
  try {
    const then = new Date(v).getTime();
    const now = Date.now();
    const diffMs = now - then;
    const abs = Math.abs(diffMs);
    const min = Math.round(abs / 60000);
    const suffix = diffMs >= 0 ? "atrás" : "em";
    const prefix = diffMs >= 0 ? "há " : "em ";
    if (abs < 60_000) return diffMs >= 0 ? "agora mesmo" : "em instantes";
    if (min < 60) return `${prefix}${min} min${suffix === "em" ? "" : ""}`.replace("em ", "em ").trim();
    const h = Math.round(min / 60);
    if (h < 48) return diffMs >= 0 ? `há ${h}h` : `em ${h}h`;
    const d = Math.round(h / 24);
    return diffMs >= 0 ? `há ${d}d` : `em ${d}d`;
  } catch {
    return v;
  }
}

const STATUS_STYLE: Record<string, string> = {
  erro: "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
  // 'invalido' nao tinha estilo nem label: caia no fallback e aparecia cru e minusculo na tela,
  // ao lado de "Ignorado" e "OK". Terminal por bloqueio = vermelho, igual erro.
  invalido: "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
  ignorado: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  processando: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900",
  pendente: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900",
  ok: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
};

const STATUS_LABEL: Record<string, string> = {
  erro: "Erro",
  // "invalido" nao diz nada ao usuario. O que aconteceu foi que o Omie RECUSOU.
  invalido: "Bloqueado",
  ignorado: "Não enviado",
  processando: "Enviando",
  pendente: "Na fila",
  ok: "OK",
};

/** Status em que o processador NÃO vai mexer mais sozinho. */
const TERMINAIS = ["invalido", "erro", "ignorado"];

/**
 * Para onde o botão da Conferência leva. Não é um destino só.
 *
 * "escolher_candidato" — contrato que AINDA NÃO tem vínculo. É o tab Escolher Candidato.
 * "contrato_cancelado" — contrato JÁ vinculado, cujo par no Omie está cancelado. Este NUNCA
 *   aparece no Escolher Candidato: a recon-candidatos-listar filtra
 *   `acao_sugerida = 'escolher_candidato'` e descarta `status_usuario in ('resolvido','vinculado')`.
 *   O balde 'contrato_cancelado' é ALARM_BUCKET, então não filtra status_usuario — é o único
 *   lugar da tela onde linha já vinculada aparece.
 */
type DestinoConferencia =
  | "escolher_candidato"
  | "contrato_cancelado"
  | "criar_contrato"
  | "criar"
  | "atribuir_modelo"
  | "resolver";

/** O texto do botao diz PARA ONDE ele leva. "Resolver na Conferencia" para tudo escondia que
 *  cada caso mora num balde diferente, e mandava gente para lista vazia. */
const DESTINO_LABEL: Record<DestinoConferencia, string> = {
  escolher_candidato: "Escolher o cadastro certo",
  contrato_cancelado: "Ver cancelados no Omie",
  criar_contrato: "Ir para Criar contrato",
  criar: "Ir para A criar no Omie",
  atribuir_modelo: "Ir para Sem modelo",
  resolver: "Ir para Divergências",
};

/** O que a Conferência já sabe sobre o contrato desta linha. É isto que diz para onde mandar
 *  quem clica: a mesma mensagem "não vinculado" tem destino diferente conforme a ação sugerida. */
type ReconInfo = {
  acao_sugerida?: string | null;
  status_usuario?: string | null;
  codigo_contrato_omie?: number | string | null;
  estado_match?: string | null;
};

function destinoDoRecon(recon?: ReconInfo | null): DestinoConferencia | undefined {
  switch (recon?.acao_sugerida ?? "") {
    case "criar_contrato":
      return "criar_contrato";
    case "criar":
      return "criar";
    case "atribuir_modelo":
      return "atribuir_modelo";
    case "resolver":
      return "resolver";
    case "escolher_candidato":
      return "escolher_candidato";
    default:
      // Sem linha na Conferência não existe balde para abrir: mandar para um deles é beco sem
      // saída (lista vazia). Nesses casos a saída é a ficha do cliente.
      return undefined;
  }
}

type Diagnostico = {
  titulo: string;
  aconteceu: string;
  passos: string[];
  descartavel?: boolean;
  destinoConferencia?: DestinoConferencia;
  podeReprocessar?: boolean;
  /** Quando a saída é a ficha do cliente (criar cadastro próprio, juntar cadastros, enviar ao Omie). */
  abrirCliente?: boolean;
};

/**
 * Traduz a linha da fila em: o que aconteceu + como corrigir + qual botão faz sentido.
 *
 * Por que existe: a tela mostrava `ultimo_erro` cru, com o prefixo técnico (`bloqueio:`,
 * `validacao:`) e um parágrafo corrido que misturava causa e solução. Pior: oferecia
 * "Reprocessar" em TODA linha, inclusive nas que não têm o que reprocessar (contrato apagado do
 * DS) e nas que reprocessar não resolve (bloqueio ainda de pé). Quem abria a tela via 7 problemas
 * e nenhum caminho.
 */
function diagnosticar(item: FilaItem, recon?: ReconInfo | null): Diagnostico {
  const erro = item.motivo ?? "";
  const status = (item.status || "").toLowerCase();

  if (item.contrato_removido) {
    return {
      titulo: "Contrato apagado no DoctorSaaS",
      aconteceu:
        "O contrato entrou na fila e depois foi excluído. Nada foi escrito no OMIE — não há o que corrigir.",
      passos: ["Descarte a linha. É só limpeza de fila."],
      descartavel: true,
    };
  }

  /**
   * Vem ANTES de qualquer diagnóstico por causa, e é de propósito: o que a linha diz que faltou
   * (modelo de contrato, de/para, o que for) já foi corrigido — o envio seguinte passou. Continuar
   * mostrando a causa antiga faz o operador ir corrigir o que já está certo, e oferecer
   * "Reprocessar" mandaria de novo ao Omie o que já está lá.
   */
  if (item.superada) {
    return {
      titulo: "Já resolvido por um envio posterior",
      aconteceu:
        "Esta tentativa falhou, mas depois dela o contrato foi enviado de novo e chegou ao OMIE. É só o rastro da tentativa antiga — não há o que corrigir.",
      passos: ["Descarte a linha. É só limpeza de fila."],
      descartavel: true,
      podeReprocessar: false,
    };
  }

  if (erro.includes("troca_de_produto")) {
    return {
      titulo: "Produto do contrato mudou",
      aconteceu:
        "O produto foi trocado no DoctorSaaS e o OMIE ainda está com a categoria do produto anterior.",
      passos: [
        "Clique em Reprocessar: a integração agora grava a categoria nova no OMIE sozinha.",
        "Se voltar a bloquear, o produto atual provavelmente não tem correspondência no OMIE — mapeie em Configurações → Integração OMIE.",
      ],
      podeReprocessar: true,
    };
  }

  if (erro.includes("depara_aponta_cancelado")) {
    return {
      titulo: "O vínculo aponta para um contrato cancelado no OMIE",
      aconteceu:
        "O contrato ligado a este cliente já está cancelado (situação 99) no OMIE. Alterar contrato cancelado não é permitido, então nada foi escrito.",
      passos: [
        "Se este contrato também foi cancelado no DoctorSaaS, os dois lados já estão iguais e não há o que enviar — confira no balde “Contrato cancelado no Omie”.",
        "Se é uma reativação: ela acontece sozinha quando o vínculo é único. Este bloqueio significa que o cliente tem mais de um candidato no OMIE — resolva o vínculo na Conferência e clique em Reprocessar.",
        "Se é um contrato novo: remova o vínculo na Conferência para que um novo seja criado no OMIE.",
      ],
      destinoConferencia: "contrato_cancelado",
      podeReprocessar: true,
    };
  }

  if (erro.includes("produto_sem_mapeamento")) {
    return {
      titulo: "Produto sem correspondência no OMIE",
      aconteceu:
        "Não existe de/para entre este produto e uma categoria do OMIE, então não dá para confirmar o que gravar. Nada foi escrito.",
      passos: [
        "Mapeie o produto em Configurações → Integração OMIE.",
        "Depois clique em Reprocessar.",
      ],
      podeReprocessar: true,
    };
  }

  /**
   * Cadastro do Omie compartilhado por 2 clientes do DoctorSaaS.
   *
   * Caía no diagnóstico genérico de "Falha ao enviar", que mandava clicar em Reprocessar --
   * e reprocessar toma o MESMO 409 de novo, porque a causa não é transitória: é uma decisão que
   * ninguém tomou. A saída já existe no produto (o "criar cadastro próprio no Omie" da ficha do
   * cliente) e a fila não apontava para ela.
   */
  if (erro.includes("MAIS DE UM cliente") || erro.includes("cadastro_omie_ja_vinculado")) {
    return {
      titulo: "O cadastro no Omie é usado por mais de um cliente daqui",
      aconteceu:
        "Dois clientes do DoctorSaaS apontam para o mesmo cadastro do Omie. Escrever nele trocaria a " +
        "fantasia, o e-mail, o telefone e o endereço do outro cliente, então nada foi escrito.",
      passos: [
        'Se este é outro estabelecimento no mesmo CNPJ: abra o cliente, clique em "Enviar ao Omie" e escolha "Criar cadastro próprio no Omie". Ele passa a ter cadastro só dele e esta linha volta a andar.',
        "Se os dois são a mesma empresa: junte os dois cadastros aqui no DoctorSaaS e depois descarte esta linha.",
      ],
      abrirCliente: true,
      podeReprocessar: true,
    };
  }

  /**
   * Cliente com mais de um contrato ativo. Vinha com o título "Faltam dados no contrato" (não
   * falta dado nenhum) e o passo "Corrija: <a própria mensagem>", que mandava ajustar o valor à
   * mão no Omie sem dizer em qual contrato -- e, nos dois casos da base, o contrato nem vínculo
   * tinha, então ajustar à mão não resolveria a linha.
   */
  if (erro.includes("multiplos contratos ativos") || erro.includes("múltiplos contratos ativos")) {
    const semVinculo = !recon?.codigo_contrato_omie;
    const destino = destinoDoRecon(recon);
    return {
      titulo: "Cliente com mais de um contrato ativo",
      aconteceu:
        "A sincronização automática de valor ainda não cobre cliente com mais de um contrato ativo: " +
        "ela não tem como decidir qual contrato do Omie recebe qual valor. Nada foi escrito no OMIE." +
        (semVinculo
          ? " Além disso, este contrato ainda não tem vínculo com um contrato do Omie."
          : ""),
      passos: semVinculo
        ? [
            "Primeiro resolva o vínculo deste contrato na Conferência: cada contrato do DoctorSaaS precisa apontar para um contrato do Omie.",
            "Enquanto o cliente tiver mais de um contrato ativo, o valor continua sendo ajustado à mão no Omie.",
          ]
        : [
            "Ajuste o valor direto no Omie, no contrato correspondente.",
            "Esta linha não vai passar sozinha enquanto o cliente tiver mais de um contrato ativo.",
          ],
      destinoConferencia: destino,
      abrirCliente: !destino,
      podeReprocessar: true,
    };
  }

  if (erro.startsWith("validacao:") || erro.includes("validacao:")) {
    // A RPC devolve um array JSON dentro da string. Vira lista, não parágrafo.
    let itensErro: string[] = [];
    const m = erro.match(/\[.*\]/s);
    if (m) {
      try {
        itensErro = JSON.parse(m[0]);
      } catch {
        /* mantém vazio; cai no texto genérico abaixo */
      }
    }
    return {
      titulo: "Faltam dados no contrato",
      aconteceu:
        "A validação do DoctorSaaS reprovou antes de enviar. Nada foi escrito no OMIE.",
      passos: itensErro.length
        ? [...itensErro.map((e) => `Corrija: ${e}`), "Depois clique em Reprocessar."]
        : ["Abra o contrato, complete os dados que faltam e clique em Reprocessar."],
      podeReprocessar: true,
    };
  }

  if (erro.includes("JA foi vinculado depois deste envio")) {
    return {
      titulo: "Alteração perdida — o vínculo veio depois",
      aconteceu:
        "Quando esta alteração saiu, o contrato ainda não estava vinculado ao OMIE, então ela não foi enviada. O vínculo existe agora, mas esta alteração específica não é reenviada sozinha.",
      passos: [
        "Abra o cliente e edite o campo de novo (basta salvar): isso gera um envio novo, já com o vínculo valendo.",
        "Depois descarte esta linha — ela não tem mais o que fazer.",
      ],
      descartavel: true,
    };
  }

  /**
   * `ignorado` = o contrato não tem de/para no OMIE, então o worker parou ANTES de escrever
   * qualquer coisa lá. São dois desfechos legítimos, e a tela oferecia só um:
   *
   *   - o contrato deve ir ao OMIE  -> vincular/criar e Reprocessar;
   *   - o contrato NÃO deve ir      -> a linha é lixo e tem que sair da fila.
   *
   * Sem o Descartar, o segundo caso não tinha saída nenhuma: Reprocessar devolve `sem_depara`
   * para sempre e a linha fica vermelha no painel eternamente. A `omie_fila_descartar` já aceita
   * `status = 'ignorado'` desde que foi escrita (é uma das 3 condições do gate) — o que faltava
   * era a tela pedir.
   */
  if (status === "ignorado") {
    // A mensagem era uma só ("resolva o vínculo na Conferência") e o botão levava sempre para
    // Escolher Candidato. Só que contrato com ação sugerida 'criar_contrato' NÃO aparece lá:
    // quem clicava chegava numa lista vazia. A Conferência já sabe o que falta em cada caso.
    const destino = destinoDoRecon(recon);
    const base = {
      podeReprocessar: true,
      descartavel: true,
      destinoConferencia: destino,
    };

    if (destino === "criar_contrato" || destino === "criar") {
      return {
        ...base,
        titulo: "Este contrato ainda não existe no OMIE",
        aconteceu:
          destino === "criar_contrato"
            ? "O cliente já está no OMIE, o contrato não. A fila automática só altera contrato que já existe lá; ela nunca cria. Nada foi escrito."
            : "Nem o cliente nem o contrato existem no OMIE. A fila automática só altera o que já está lá; ela nunca cria. Nada foi escrito.",
        passos: [
          destino === "criar_contrato"
            ? 'Crie o contrato no OMIE: use o botão abaixo (balde "Criar contrato" da Conferência) ou "Enviar ao Omie" na ficha do cliente.'
            : 'Crie cliente e contrato no OMIE: use o botão abaixo (balde "A criar no Omie") ou "Enviar ao Omie" na ficha do cliente.',
          "Criado o contrato, esta linha não tem mais função: descarte. As alterações seguintes já vão sozinhas.",
          "Se este contrato NÃO deve ir ao OMIE, descarte a linha: nada foi escrito lá.",
        ],
      };
    }

    if (destino === "escolher_candidato") {
      return {
        ...base,
        titulo: "Qual cadastro do OMIE é este cliente?",
        aconteceu:
          "O CNPJ aparece em mais de um cadastro, então o vínculo não pôde ser criado sozinho e a alteração não foi enviada. Nada foi escrito no OMIE.",
        passos: [
          "Escolha o cadastro certo na Conferência (botão abaixo). Isso cria o vínculo e não altera nada no OMIE.",
          "Depois clique em Reprocessar para esta alteração seguir.",
        ],
      };
    }

    if (destino) {
      return {
        ...base,
        titulo: "Contrato ainda não vinculado ao OMIE",
        aconteceu:
          "A fila automática só altera contrato que já existe no OMIE. Este ainda está pendente na Conferência. Nada foi escrito.",
        passos: [
          "Resolva a pendência na Conferência (botão abaixo) e depois clique em Reprocessar.",
          "Se este contrato não deve ir ao OMIE, descarte a linha.",
        ],
      };
    }

    return {
      ...base,
      titulo: "Contrato ainda não vinculado ao OMIE",
      aconteceu:
        "A fila automática só altera contrato que já existe no OMIE, e este contrato não aparece na " +
        "Conferência (o que costuma acontecer com contrato cancelado ou recém-criado). Nada foi escrito.",
      passos: [
        'Se ele deve ir ao OMIE: abra o cliente e use "Enviar ao Omie".',
        "Se não deve: descarte a linha. Nada foi escrito lá, é só limpeza de fila.",
      ],
      abrirCliente: true,
    };
  }

  if (status === "erro") {
    return {
      titulo: "Falha ao enviar",
      aconteceu: erro || "O envio falhou e as tentativas se esgotaram.",
      passos: ["Se a causa já foi resolvida, clique em Reprocessar."],
      podeReprocessar: true,
    };
  }

  return {
    titulo: STATUS_LABEL[status] ?? "Em andamento",
    aconteceu: erro || "—",
    passos: [],
    podeReprocessar: TERMINAIS.includes(status),
  };
}

function StatusBadge({ status }: { status?: string | null }) {
  const s = (status || "").toLowerCase();
  const cls = STATUS_STYLE[s] ?? "bg-muted text-foreground border-border";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {STATUS_LABEL[s] ?? status ?? "—"}
    </span>
  );
}

export default function OmieFilaSincronizacaoPanel({
  tid,
  onIrParaConferencia,
}: {
  tid: string | null | undefined;
  onIrParaConferencia?: (cnpj: string, destino: DestinoConferencia) => void;
}) {
  // Conta Omie escolhida no seletor de Integracoes -> Omie. Ver OmieContaContext.
  const { conta } = useOmieConta();
  const navigate = useNavigate();
  const [filtroStatus, setFiltroStatus] = useState<string | null>(null);
  const [okOpen, setOkOpen] = useState(false);

  const query = useQuery({
    queryKey: ["omie-fila-status", tid, conta?.id],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("omie_fila_status" as any, { p_tenant_id: tid, p_conta_integration_id: conta?.id });
      if (error) throw error;
      return (data ?? {}) as FilaStatus;
    },
  });

  const data = query.data;
  const itens = data?.itens ?? [];

  // ========================================================================
  // O que a Conferência sabe sobre cada contrato parado.
  //
  // A mesma mensagem ("contrato não vinculado") tem destino diferente conforme a ação sugerida:
  // 'criar_contrato' não aparece em Escolher Candidato, e era para lá que a tela mandava todo
  // mundo. Sem esta leitura não dá para escolher o balde certo nem para dizer se o contrato já
  // tem par no Omie.
  //
  // Só das linhas travadas (as outras estão andando) e só quando existe alguma.
  // ========================================================================
  const contratosTravados = useMemo(
    () =>
      Array.from(
        new Set(
          itens
            .filter((i) => TERMINAIS.includes((i.status || "").toLowerCase()))
            .map((i) => i.contrato_id)
            .filter((id): id is string => !!id)
        )
      ),
    [itens]
  );

  const reconQuery = useQuery({
    queryKey: ["omie-fila-recon", tid, conta?.id, contratosTravados.join(",")],
    enabled: !!tid && !!conta?.id && contratosTravados.length > 0,
    queryFn: async () => {
      const { data: rows, error } = await (supabase.from("reconciliacao_cadastro" as any) as any)
        .select("ds_contract_id, acao_sugerida, status_usuario, codigo_contrato_omie, estado_match")
        .eq("tenant_id", tid)
        .eq("conta_integration_id", conta?.id)
        .in("ds_contract_id", contratosTravados);
      if (error) throw error;
      const mapa: Record<string, ReconInfo> = {};
      for (const r of rows ?? []) mapa[r.ds_contract_id] = r as ReconInfo;
      return mapa;
    },
  });
  const reconPorContrato = reconQuery.data ?? {};
  const resumo = data?.resumo ?? {};
  const saude = data?.saude ?? {};
  const okRecentes = data?.ok_recentes ?? [];

  const temAtivo = useMemo(
    () => (resumo.pendente ?? 0) > 0 || (resumo.processando ?? 0) > 0,
    [resumo]
  );

  // ========================================================================
  // A fila para de esperar clique para o que nao tem decisao humana nenhuma.
  //
  // Ao abrir o painel, o omie_fila_auto_resolver FECHA as linhas em que nao ha nada a fazer no
  // Omie (contrato apagado no DoctorSaaS depois de entrar na fila, linha superada por um envio
  // posterior que chegou la, e cancelamento de contrato que nunca existiu no Omie) e DEVOLVE
  // para a fila as que estavam paradas por uma validacao do DoctorSaaS ja corrigida.
  //
  // Antes, essas linhas ficavam vermelhas esperando um clique que so podia dar um resultado. As
  // duas primeiras a propria tela ja sabia diagnosticar ("pode descartar") e mesmo assim pedia a
  // acao. Cada fechamento automatico vira um audit_events, senao ninguem responderia depois por
  // que a linha sumiu.
  //
  // Uma vez por conta aberta, nao a cada refresh: o auto-refresh de 30s nao repete isto.
  // ========================================================================
  const autoResolvido = useRef<string | null>(null);
  useEffect(() => {
    if (!tid || !conta?.id) return;
    const chave = `${tid}|${conta.id}`;
    if (autoResolvido.current === chave) return;
    autoResolvido.current = chave;
    (async () => {
      const { data, error } = await (supabase.rpc as any)("omie_fila_auto_resolver", {
        p_tenant_id: tid,
        p_conta_integration_id: conta.id,
      });
      // Silencioso de proposito: isto e melhoria de bastidor. Se falhar, a tela continua a mesma
      // de antes (com os botoes manuais) em vez de abrir um erro que o usuario nao pediu.
      if (error) return;
      const r = (data ?? {}) as { fechadas?: number; reenfileiradas?: number };
      const fechadas = r.fechadas ?? 0;
      const reenfileiradas = r.reenfileiradas ?? 0;
      if (fechadas + reenfileiradas === 0) return;
      const partes: string[] = [];
      if (fechadas > 0) {
        partes.push(
          fechadas === 1
            ? "1 linha fechada: nao havia nada a fazer no Omie"
            : `${fechadas} linhas fechadas: nao havia nada a fazer no Omie`
        );
      }
      if (reenfileiradas > 0) {
        partes.push(
          reenfileiradas === 1
            ? "1 linha voltou para a fila: a causa ja tinha sido corrigida"
            : `${reenfileiradas} linhas voltaram para a fila: a causa ja tinha sido corrigida`
        );
      }
      toast.success("A fila resolveu sozinha o que dava.", {
        description: partes.join(" · "),
        duration: 9000,
      });
      query.refetch();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tid, conta?.id]);

  // Auto-refresh 30s enquanto houver pendente/processando
  useEffect(() => {
    if (!temAtivo) return;
    const id = setInterval(() => {
      query.refetch();
    }, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temAtivo]);

  // Linha apontada pela notificação (?fila=<id>).
  const { destacarId, refDestaque } = useLinhaDestacada(!query.isLoading);
  const destacada = destacarId ? itens.find((i) => i.fila_id === destacarId) : undefined;

  const itensFiltrados = useMemo(() => {
    const base = filtroStatus
      ? itens.filter((i) => (i.status || "").toLowerCase() === filtroStatus)
      : itens;
    // Quem chegou por notificação tem que ver A linha, não a lista: se o filtro
    // ligado a esconder, ela sobe para o topo.
    if (!destacada || base.some((i) => i.fila_id === destacada.fila_id)) return base;
    return [destacada, ...base];
  }, [itens, filtroStatus, destacada]);

  // Erro de permissão / falha
  if (query.isError) {
    const msg = (query.error as any)?.message || "Falha ao carregar a fila.";
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Fila de sincronização
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{msg}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const resumoEntries = Object.entries(resumo).filter(([, v]) => Number(v) > 0);
  const orderStatus = ["erro", "ignorado", "processando", "pendente", "ok"];
  resumoEntries.sort(
    ([a], [b]) => (orderStatus.indexOf(a) === -1 ? 99 : orderStatus.indexOf(a)) - (orderStatus.indexOf(b) === -1 ? 99 : orderStatus.indexOf(b))
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Fila de sincronização
            {data?.gerado_em && (
              <span className="text-xs font-normal text-muted-foreground">
                · {formatDateTime(data.gerado_em)}
              </span>
            )}
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isLoading ? (
          <>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-24 w-full" />
          </>
        ) : (
          <>
            {/* Faixa de saúde */}
            {saude.pausado && (
              <Alert variant="destructive">
                <Pause className="h-4 w-4" />
                <AlertDescription>
                  ⏸️ Integração pausada — nada está sendo enviado ao Omie. A fila está acumulando.
                </AlertDescription>
              </Alert>
            )}
            {!saude.pausado && saude.sync_ativo === false && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  ⚠️ Sincronização automática desligada — alterações não estão sendo enfileiradas.
                </AlertDescription>
              </Alert>
            )}
            {!saude.pausado && saude.sync_ativo !== false && saude.cron_saudavel === false && (
              <Alert className="border-amber-500/50 text-amber-900 dark:text-amber-200 [&>svg]:text-amber-600">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  ⚠️ O processador não roda desde {formatDateTime(saude.cron_ultima)} — a fila não está andando.
                </AlertDescription>
              </Alert>
            )}
            {saude.bloqueado_ate && new Date(saude.bloqueado_ate).getTime() > Date.now() && (
              <Alert className="border-amber-500/50 text-amber-900 dark:text-amber-200 [&>svg]:text-amber-600">
                <Clock className="h-4 w-4" />
                <AlertDescription>
                  ⏳ Omie pediu espera até {formatDateTime(saude.bloqueado_ate)}. Volta sozinho.
                </AlertDescription>
              </Alert>
            )}
            {saude.modo_teste && (
              <Alert className="border-amber-500/50 text-amber-900 dark:text-amber-200 [&>svg]:text-amber-600">
                <TestTube2 className="h-4 w-4" />
                <AlertDescription>
                  🧪 Modo teste: só os contratos da whitelist são processados. O resto fica na fila.
                </AlertDescription>
              </Alert>
            )}

            {/* Clique de notificação que não achou a linha. Dizer isso é melhor do
                que abrir a lista inteira e deixar a pessoa procurando o que já saiu. */}
            {destacarId && !destacada && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  A linha apontada pelo aviso não está mais aqui. Ou ela já foi processada e saiu da
                  fila, ou é de outra conta Omie: confira o seletor de conta no topo da tela.
                </AlertDescription>
              </Alert>
            )}

            {/* Resumo (chips) */}
            {resumoEntries.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {resumoEntries.map(([status, qtd]) => {
                  const s = status.toLowerCase();
                  const ativo = filtroStatus === s;
                  const cls = STATUS_STYLE[s] ?? "bg-muted text-foreground border-border";
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setFiltroStatus(ativo ? null : s)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${cls} ${
                        ativo ? "ring-2 ring-offset-1 ring-primary/40" : "opacity-90 hover:opacity-100"
                      }`}
                    >
                      {STATUS_LABEL[s] ?? status}
                      <span className="font-semibold">{Number(qtd).toLocaleString("pt-BR")}</span>
                    </button>
                  );
                })}
                {filtroStatus && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setFiltroStatus(null)}
                  >
                    Limpar filtro
                  </Button>
                )}
              </div>
            )}

            {/* Lista */}
            {itensFiltrados.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                {filtroStatus
                  ? "Nenhum item neste status."
                  : "Nada parado. Tudo que foi alterado já está no Omie."}
              </div>
            ) : (
              <div className="space-y-2">
                {itensFiltrados.map((item, i) => {
                  const status = (item.status || "").toLowerCase();
                  const isIgnorado = status === "ignorado";
                  const dg = diagnosticar(
                    item,
                    item.contrato_id ? reconPorContrato[item.contrato_id] : null
                  );
                  const terminal = TERMINAIS.includes(status);
                  const canReprocess =
                    terminal && !!item.fila_id && dg.podeReprocessar !== false && !item.contrato_removido;
                  return (
                    <div
                      key={item.fila_id ?? i}
                      ref={item.fila_id && item.fila_id === destacarId ? refDestaque : undefined}
                      className={`rounded-lg border p-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between ${
                        item.fila_id && item.fila_id === destacarId ? CLASSE_DESTAQUE : ""
                      }`}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">{item.cliente || "—"}</span>
                          {item.cnpj && (
                            <span className="text-xs text-muted-foreground font-mono">
                              {formatCNPJ(item.cnpj)}
                            </span>
                          )}
                          {/* Linha superada continuava com o selo vermelho "Bloqueado": lida como
                              problema em aberto quando o contrato ja esta certo no Omie. */}
                          {item.superada ? (
                            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium bg-muted text-muted-foreground border-border">
                              Resolvido depois
                            </span>
                          ) : (
                            <StatusBadge status={item.status} />
                          )}
                          <Badge variant="outline" className="text-[10px]">
                            {labelOrigem(item.origem)}
                          </Badge>
                          {/* So faz sentido enquanto ainda ha o que tentar. Em linha terminal,
                              "15 tentativas" lia como esforco em curso -- e ela parou faz dias. */}
                          {!terminal && (item.tentativas ?? 0) > 0 && (
                            <span className="text-[11px] text-muted-foreground">
                              {item.tentativas} tentativa{(item.tentativas ?? 0) > 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                        {/* O que aconteceu — em vez do ultimo_erro cru com prefixo tecnico. */}
                        <p className="text-xs font-medium text-foreground">{dg.titulo}</p>
                        {dg.aconteceu && (
                          <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                            {dg.aconteceu}
                          </p>
                        )}
                        {/* Como corrigir — passos, nao parágrafo. */}
                        {dg.passos.length > 0 && (
                          <div className="rounded-md border border-border/60 bg-muted/40 px-2.5 py-2">
                            <p className="text-[11px] font-medium text-foreground mb-1">Como resolver</p>
                            <ol className="list-decimal pl-4 space-y-0.5 text-[11px] text-muted-foreground">
                              {dg.passos.map((p, k) => (
                                <li key={k}>{p}</li>
                              ))}
                            </ol>
                          </div>
                        )}
                        <div className="text-[11px] text-muted-foreground">
                          Parado {relativeTime(item.enfileirado_em)}
                          {/* Em linha terminal nao existe "proxima tentativa": o processador nao
                              volta nela sozinho. Mostrar uma data no passado ("ha 3d") fazia
                              parecer que ainda estava tentando. Idem o contador de tentativas. */}
                          {!terminal && item.proxima_tentativa_em && (
                            <> · Próxima tentativa {relativeTime(item.proxima_tentativa_em)}</>
                          )}
                          {terminal && (
                            <>{item.superada ? <> · Nada pendente</> : <> · Não será reenviado sozinho</>}</>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        {/* O destino NAO e o mesmo para os dois casos: contrato ja vinculado nunca
                            aparece no Escolher Candidato (ver DestinoConferencia). Mandar os dois
                            para la era um beco sem saida -- o usuario chegava numa lista vazia. */}
                        {dg.destinoConferencia && item.cnpj && onIrParaConferencia && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            onClick={() =>
                              onIrParaConferencia(item.cnpj as string, dg.destinoConferencia as DestinoConferencia)
                            }
                          >
                            <ExternalLink className="h-3 w-3" />
                            {DESTINO_LABEL[dg.destinoConferencia]}
                          </Button>
                        )}
                        {/* Quando a saída não é um balde da Conferência e sim uma decisão na ficha
                            do cliente (cadastro próprio no Omie, juntar cadastros, enviar ao Omie),
                            o caminho tem que estar aqui: era o passo que a tela descrevia em texto
                            e deixava a pessoa procurar. */}
                        {dg.abrirCliente && item.cliente_id && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            onClick={() => navigate(`/clientes/${item.cliente_id}`)}
                          >
                            <ExternalLink className="h-3 w-3" />
                            Abrir o cliente
                          </Button>
                        )}
                        {dg.descartavel && item.fila_id && (
                          <DescartarButton filaId={item.fila_id} onDone={() => query.refetch()} />
                        )}
                        {canReprocess && (
                          <ReprocessarButton
                            filaId={item.fila_id as string}
                            contratoId={item.contrato_id}
                            tenantId={tid}
                            onDone={() => query.refetch()}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* OK recentes */}
            {okRecentes.length > 0 && (
              <Collapsible open={okOpen} onOpenChange={setOkOpen}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {okOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    Últimas sincronizações ({okRecentes.length})
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <div className="rounded-lg border divide-y">
                    {okRecentes.map((r, i) => (
                      <div
                        key={i}
                        className="px-3 py-2 text-xs flex items-center justify-between gap-2 flex-wrap"
                      >
                        <span className="font-medium truncate">{r.cliente || "—"}</span>
                        <span className="text-muted-foreground">
                          {labelOrigem(r.origem)} · {relativeTime(r.processado_em)}
                        </span>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
