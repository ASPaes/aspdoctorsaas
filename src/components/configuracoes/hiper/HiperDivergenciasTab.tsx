import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, ChevronDown, ChevronRight, ExternalLink, EyeOff, Loader2, RefreshCw, Wand2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Explica, Origem, TIPO_CONTRATO, Vazio, anual, brl, cnpjMask, nomeTipo, num, rotuloRecorrencia } from "./ui";
import type { LinhaRecon } from "./useHiperDados";

/**
 * Onde toda correção acontece. As outras abas mostram números; esta é a única
 * em que algo é decidido.
 *
 * A ordem das famílias na lista não é estética: o tipo de contrato decide QUAL
 * regra de dinheiro vale, e a filial decide DE QUEM o dinheiro é. Atacar valor
 * antes dessas duas é corrigir duas vezes.
 */
const FAMILIAS: { chave: string; rotulo: string; explica: string; peso: number }[] = [
  { chave: "tipo_contrato_ausente", rotulo: "Sem tipo de contrato", peso: 1,
    explica: "Contrato ativo sem modelo definido. Enquanto ele não for classificado, nenhuma regra de valor se aplica a este cliente." },
  { chave: "tipo_contrato_divergente", rotulo: "Tipo de contrato diferente", peso: 1,
    explica: "O modelo aqui não é o que o portal diz. É ele que decide se o MRR pode ser comparado." },
  { chave: "filial_faltando_no_ds", rotulo: "Filial só no Hiper", peso: 2,
    explica: "O portal tem estabelecimento com CNPJ próprio que não existe como cadastro aqui." },
  { chave: "filial_com_valor", rotulo: "Filial com valor próprio", peso: 2,
    explica: "A matriz é quem deve carregar o total. Filial com valor pode estar duplicando MRR — ou pode ser filial que paga a própria conta, e aí é só registrar." },
  { chave: "filial_sem_matriz", rotulo: "Filial sem matriz certa", peso: 2,
    explica: "O cadastro casa com um estabelecimento, mas não aponta para a matriz da conta." },
  { chave: "filial_e_conta_propria", rotulo: "Filial que é conta própria", peso: 2,
    explica: "Está amarrada como filial aqui, mas o portal emite conta separada para ela — então não é filial." },
  { chave: "cadastro_duplicado", rotulo: "Cadastro duplicado", peso: 2,
    explica: "“Filial” com o mesmo CNPJ da matriz. É o mesmo cadastro duas vezes." },
  { chave: "custo_divergente", rotulo: "Custo diferente", peso: 3,
    explica: "O custo no contrato daqui não bate com o que a Hiper cobra ou retém." },
  { chave: "mrr_divergente", rotulo: "MRR diferente", peso: 3,
    explica: "Só nas centrais: quem cobra o cliente é a Hiper, então o valor dela é a verdade." },
  { chave: "modulo_a_mais_no_hiper", rotulo: "Módulo só no Hiper", peso: 4, explica: "O portal cobra um módulo que o contrato daqui não tem." },
  { chave: "modulo_a_menos_no_hiper", rotulo: "Módulo só aqui", peso: 4, explica: "O contrato tem um módulo que o portal não cobra." },
  { chave: "modulo_custo_divergente", rotulo: "Custo de módulo diferente", peso: 4, explica: "Módulo vinculado com custo diferente dos dois lados." },
  { chave: "modulo_quantidade_divergente", rotulo: "Quantidade de módulo diferente", peso: 4,
    explica: "O portal diz uma quantidade e o contrato daqui tem outra — normalmente o número de caixas do plano." },
  { chave: "sem_dono", rotulo: "Conta sem cliente aqui", peso: 5, explica: "Conta viva no Hiper que nenhum cadastro daqui é dono. Custo saindo sem receita entrando." },
  { chave: "sem_conta_no_hiper", rotulo: "Cliente sem conta no Hiper", peso: 5, explica: "Contrato ativo aqui sem conta no portal." },
  { chave: "conta_inativa_no_hiper", rotulo: "Conta inativa no Hiper", peso: 5, explica: "O cliente saiu no portal e o contrato daqui continua ativo." },
  { chave: "cnpj_ambiguo", rotulo: "CNPJ com mais de um cliente", peso: 5, explica: "Precisa de escolha humana: dois cadastros disputam a mesma conta." },
  { chave: "valor_pode_ser_do_periodo", rotulo: "Valor pode ser do período", peso: 1,
    explica: "A mensalidade do portal é 6× ou mais a daqui — isso normalmente não é cadastro errado, é o cliente que paga o período inteiro de uma vez e o portal lança tudo num mês só. Enquanto o contrato aqui estiver como mensal, o valor não é comparado nem gravado: aplicar multiplicaria o MRR. Corrija a recorrência na ficha do cliente e sincronize — o sistema passa a dividir pelo período sozinho." },
  { chave: "sem_valor_no_portal", rotulo: "Portal sem valor do mês", peso: 5,
    explica: "A conta está ativa no Hiper, mas o portal não enviou valor nenhum do mês — normalmente porque o último extrato dela é de um mês anterior ao do lote. Sem valor não há o que comparar, e comparar contra zero zeraria o custo do cliente. A linha fica na lista para você conferir na mão ou rebuscar no portal." },
  { chave: "razao_social_divergente", rotulo: "Razão social diferente", peso: 6, explica: "Comparação já ignora acento, pontuação e sufixo societário." },
];

const META = Object.fromEntries(FAMILIAS.map((f) => [f.chave, f]));

/**
 * O portal deixou de informar o que ele DEVERIA informar para este tipo.
 *
 * No Hiperador o MRR vazio é o normal — quem cobra o cliente é a revenda e o
 * portal não conhece o preço. Tratar isso como falta jogaria as 342 contas de
 * Hiperador na lista e esconderia as 24 das centrais, que são o caso real.
 */
const semValorEsperado = (r: LinhaRecon) =>
  r.responsavel_tipo === "hiper"
    ? r.custo_hiper == null || Number(r.custo_hiper) === 0
    : r.mrr_hiper == null || Number(r.mrr_hiper) === 0
      || r.custo_hiper == null || Number(r.custo_hiper) === 0;

/**
 * O que o botão sabe gravar, e o efeito de cada coisa. A unidade aqui é a AÇÃO
 * e não a divergência: "tipo de contrato ausente" e "tipo de contrato
 * divergente" gravam o mesmo campo, e em lote é por ação que se escolhe.
 *
 * O resto continua sendo decisão na ficha: filial mexe em árvore de cadastro,
 * cadastro duplicado é fusão, e conta sem dono não tem onde escrever.
 */
const ACOES: {
  acao: string;
  rotulo: string;
  divs: string[];
  detalhe: (r: LinhaRecon) => string;
  efeito?: string;
}[] = [
  {
    acao: "tipo_contrato",
    rotulo: "Tipo de contrato",
    divs: ["tipo_contrato_ausente", "tipo_contrato_divergente"],
    detalhe: (r) => `${r.modelo_contrato_ds ?? "sem modelo"} → ${nomeTipo(r.responsavel_tipo)}`,
  },
  {
    acao: "custo",
    rotulo: "Custo",
    divs: ["custo_divergente"],
    detalhe: (r) => `${brl(r.custo_ds)} → ${brl(r.custo_hiper)} por mês`,
    efeito: "Atualiza o custo do contrato e o custo de operação do cliente. Não mexe em receita.",
  },
  {
    acao: "mrr",
    rotulo: "Mensalidade (MRR)",
    divs: ["mrr_divergente"],
    detalhe: (r) => `${brl(r.mensalidade_ds)} → ${brl(r.mrr_hiper)} por mês`,
    efeito: "Muda a mensalidade do cliente e o MRR da base. Não gera movimento de upsell/downsell, então o Net New do mês não vai explicar essa diferença. Nos tenants com Omie ativo, o novo valor vai para o ERP.",
  },
  {
    acao: "modulos",
    rotulo: "Módulos",
    divs: ["modulo_a_mais_no_hiper", "modulo_custo_divergente", "modulo_quantidade_divergente"],
    detalhe: (r) => {
      const m = (r.detalhe?.modulos ?? {}) as any;
      const partes: string[] = [];
      if (m.a_mais?.length) partes.push(`${m.a_mais.length} a inserir`);
      if (m.quantidade?.length) partes.push(`${m.quantidade.length} com quantidade errada`);
      if (m.custo?.length) partes.push(`${m.custo.length} com custo errado`);
      return partes.join(" · ") || "acertar com o portal";
    },
    efeito: "Insere no contrato os módulos que o portal cobra e os que o plano implica (o Hiper Caixa vem do número de caixas da conta), e acerta quantidade e custo dos que já existem. Módulo do Hiper entra sem preço de venda — só custo.",
  },
  {
    acao: "razao_social",
    rotulo: "Razão social",
    divs: ["razao_social_divergente"],
    detalhe: (r) => `usar “${r.razao_social_hiper}”`,
    efeito: "Enfileira sincronismo do cadastro para o Omie.",
  },
];

const ACAO = Object.fromEntries(ACOES.map((a) => [a.acao, a]));

/** As ações que fazem sentido para esta linha, na ordem da lista acima. */
const acoesDe = (r: LinhaRecon) =>
  ACOES.filter((a) => a.divs.some((d) => r.divergencias.includes(d))).map((a) => a.acao);

export default function HiperDivergenciasTab({ tid, recon }: { tid: string | null; recon: LinhaRecon[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [familias, setFamilias] = useState<Set<string>>(new Set());
  const [comFilial, setComFilial] = useState("todas");
  const [tipos, setTipos] = useState<Set<string>>(new Set());
  const [valorHiper, setValorHiper] = useState("todos");
  const [status, setStatus] = useState("pendente");
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const POR_PAGINA = 100;
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [confirmar, setConfirmar] = useState<{ linhas: LinhaRecon[]; escolhidas: Set<string> } | null>(null);

  const alternar = (id: string) =>
    setSelecionados((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const qtdSemValor = useMemo(
    () => recon.filter((r) => r.estado_match === "vinculado"
      && r.divergencias.length > 0 && semValorEsperado(r)).length,
    [recon],
  );

  const porTipo = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of recon) {
      if (status !== "todos" && r.status_usuario !== status) continue;
      if (r.divergencias.length === 0) continue;
      const t = r.responsavel_tipo ?? "";
      if (t) m[t] = (m[t] ?? 0) + 1;
    }
    return m;
  }, [recon, status]);

  const contagem = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of recon) {
      if (status !== "todos" && r.status_usuario !== status) continue;
      for (const d of r.divergencias) m[d] = (m[d] ?? 0) + 1;
    }
    return m;
  }, [recon, status]);

  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const qd = q.replace(/\D/g, "");
    return recon
      .filter((r) => r.divergencias.length > 0)
      .filter((r) => status === "todos" || r.status_usuario === status)
      // Nenhuma marcada = todas. Com várias marcadas, basta UMA bater: quem
      // filtra por "filial sem matriz" e "filial com valor" quer os dois montes
      // juntos, não a interseção deles.
      .filter((r) => familias.size === 0 || r.divergencias.some((d) => familias.has(d)))
      // Vazio = todos. Marcar mais de um soma os montes: "Central de Leads" com
      // "Central de Cobrança" é o recorte de quem a Hiper fatura, e é natural
      // olhar os dois juntos contra o Hiperador.
      .filter((r) => tipos.size === 0 || tipos.has(r.responsavel_tipo ?? ""))
      .filter((r) => {
        if (valorHiper === "todos") return true;
        return valorHiper === "sem" ? semValorEsperado(r) : !semValorEsperado(r);
      })
      .filter((r) => {
        if (comFilial === "todas") return true;
        const n = ((r.detalhe?.filiais?.grupo ?? []) as any[]).length;
        return comFilial === "com" ? n > 0 : n === 0;
      })
      .filter((r) => !q
        // O código do cadastro vem PRIMEIRO e casa exato: é por ele que a
        // operação chama o cliente ("o 351"), e como substring ele batia no
        // CNPJ de outros três antes de achar o certo.
        || String(r.codigo_sequencial_ds ?? "") === q
        || (r.razao_social_ds ?? "").toLowerCase().includes(q)
        || (r.razao_social_hiper ?? "").toLowerCase().includes(q)
        || (qd.length >= 4 && (r.cnpj_norm ?? "").includes(qd))
        // A filial não tem linha própria: ela vive dentro da matriz. Sem
        // procurar aqui dentro, buscar pelo nome dela não acha nada e parece
        // que ela não está no sistema.
        || ((r.detalhe?.filiais?.grupo ?? []) as any[]).some((f) =>
             String(f.codigo ?? "") === q
             || String(f.nome ?? "").toLowerCase().includes(q)
             || (qd.length >= 4 && String(f.cnpj ?? "").includes(qd))))
      .sort((a, b) => {
        const pa = Math.min(...a.divergencias.map((d) => META[d]?.peso ?? 9));
        const pb = Math.min(...b.divergencias.map((d) => META[d]?.peso ?? 9));
        if (pa !== pb) return pa - pb;
        // dentro da mesma família, o dinheiro manda
        const va = Math.abs(Number(a.custo_hiper ?? 0) - Number(a.custo_ds ?? 0));
        const vb = Math.abs(Number(b.custo_hiper ?? 0) - Number(b.custo_ds ?? 0));
        return vb - va;
      });
  }, [recon, familias, comFilial, tipos, valorHiper, status, busca]);

  /**
   * Buscar por nome ou CNPJ nunca trunca: o resultado é curto e a pessoa está
   * procurando UM cliente. Sem isso, quem some do teto parece ter sumido do
   * sistema — e some justamente quem já teve as divergências mais graves
   * resolvidas, porque a régua de ataque joga o resto para o fim da fila.
   */
  const buscando = busca.trim().length > 0;
  const paginas = Math.max(1, Math.ceil(linhas.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, paginas);
  const visiveis = buscando
    ? linhas
    : linhas.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA);

  /** Só entra no lote quem está na tela E tem algo que o botão sabe gravar. */
  const selecionaveis = useMemo(() => visiveis.filter((l) => acoesDe(l).length > 0), [visiveis]);

  const marcar = async (id: string, novo: "resolvido" | "ignorado" | "pendente") => {
    setOcupado(id);
    try {
      const { error } = await (supabase.from("reconciliacao_hiper" as any) as any)
        .update({
          status_usuario: novo,
          resolvido_em: novo === "pendente" ? null : new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["hiper_recon"] });
    } catch (e: any) {
      toast({ title: "Não foi possível marcar", description: e.message, variant: "destructive" });
    } finally { setOcupado(null); }
  };

  const aplicar = async () => {
    if (!confirmar) return;
    const { linhas, escolhidas } = confirmar;
    setOcupado("aplicando");
    try {
      const { data, error } = await supabase.rpc("hiper_aplicar_correcao" as any, {
        p_tenant_id: tid,
        p_recon_ids: linhas.map((l) => l.id),
        p_acoes: Array.from(escolhidas),
      } as any);
      if (error) throw error;
      const r = data as any;
      if (!r?.ok) throw new Error(r?.erro || "Não foi possível aplicar.");
      setConfirmar(null);
      setSelecionados(new Set());
      // O que foi recusado importa tanto quanto o que gravou: sem isso o
      // operador acha que atualizou 200 e atualizou 40.
      const motivos = (r.motivos ?? []) as { motivo: string; qt: number }[];
      toast({
        title: r.clientes === 0
          ? "Nada foi atualizado"
          : `${num(r.clientes)} ${r.clientes === 1 ? "cliente atualizado" : "clientes atualizados"} · ${num(r.aplicado.length)} ${r.aplicado.length === 1 ? "campo" : "campos"}`,
        description: motivos.length
          ? `Pulados: ${motivos.map((m) => `${m.qt}× ${m.motivo}`).join(" · ")}`
          : undefined,
        variant: r.clientes === 0 ? "destructive" : undefined,
      });
      qc.invalidateQueries({ queryKey: ["hiper_recon"] });
    } catch (e: any) {
      toast({ title: "Não foi possível aplicar", description: e.message, variant: "destructive" });
    } finally { setOcupado(null); }
  };

  /** Relê ESTA conta no portal e reconcilia. Para quando o dado de lá mudou e
   *  não vale esperar a sincronização da carteira inteira. */
  const rebuscar = async (idPortal: string) => {
    setOcupado(`portal-${idPortal}`);
    try {
      const { data, error } = await supabase.functions.invoke("hiper-integration-call", {
        body: { acao: "puxar_um", tenant_id: tid, id_portal: idPortal },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falhou.");
      const res = data.resultado ?? {};
      toast({
        title: "Conta relida do portal",
        description: res.portal_atualizado === false
          ? "O portal ainda é a versão sem módulos e filiais — só o cadastro foi atualizado."
          : `${num(res.modulos)} módulos · ${num(res.filiais)} filiais`,
      });
      qc.invalidateQueries({ queryKey: ["hiper_recon"] });
    } catch (e: any) {
      toast({ title: "Não foi possível rebuscar", description: e.message, variant: "destructive" });
    } finally { setOcupado(null); }
  };

  const decidirFilial = async (clienteId: string, decisao: string) => {
    setOcupado(clienteId);
    try {
      const { error } = await (supabase.from("hiper_filial_decisao" as any) as any)
        .upsert({ tenant_id: tid, cliente_id: clienteId, decisao }, { onConflict: "tenant_id,cliente_id" });
      if (error) throw error;
      toast({
        title: "Decisão registrada",
        description: "Ela sobrevive ao recálculo: esta filial não volta como pendência.",
      });
      qc.invalidateQueries({ queryKey: ["hiper_recon"] });
    } catch (e: any) {
      toast({ title: "Não foi possível registrar", description: e.message, variant: "destructive" });
    } finally { setOcupado(null); }
  };

  return (
    <div className="space-y-3">
      <Explica>
        Uma linha por cliente. Abra a seta e ela mostra tudo o que está divergindo nele.
        A lista já vem na ordem em que compensa atacar: <strong>tipo de contrato</strong> primeiro
        porque ele decide qual regra de dinheiro vale, depois <strong>filial</strong> porque ela
        decide de quem o dinheiro é, e só então <strong>valor</strong>. Ao contrário,
        você corrige duas vezes.
      </Explica>

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Código do cadastro, nome ou CNPJ…" value={busca}
          onChange={(e) => setBusca(e.target.value)} className="max-w-xs" />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPagina(1); }}
          className="h-9 rounded-md border bg-background px-3 text-sm">
          <option value="pendente">Pendentes</option>
          <option value="resolvido">Resolvidas</option>
          <option value="ignorado">Ignoradas</option>
          <option value="todos">Todas</option>
        </select>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="h-9 justify-between gap-2 font-normal max-w-[22rem]">
              <span className="truncate">
                {familias.size === 0 ? "Todas as famílias"
                  : familias.size === 1 ? (META[Array.from(familias)[0]]?.rotulo ?? "1 família")
                  : `${familias.size} famílias`}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-2 max-h-[26rem] overflow-y-auto">
            <div className="flex items-center justify-between px-1 pb-2">
              <span className="text-xs text-muted-foreground">
                Marque quantas quiser — basta uma bater
              </span>
              {familias.size > 0 && (
                <button type="button" className="text-xs underline text-muted-foreground"
                  onClick={() => { setFamilias(new Set()); setPagina(1); }}>
                  limpar
                </button>
              )}
            </div>
            {FAMILIAS.filter((f) => contagem[f.chave]).map((f) => (
              <label key={f.chave}
                className="flex items-start gap-2 rounded px-1 py-1.5 text-sm cursor-pointer hover:bg-muted/50">
                <Checkbox className="mt-0.5" checked={familias.has(f.chave)}
                  onCheckedChange={() => {
                    setFamilias((s) => {
                      const n = new Set(s);
                      n.has(f.chave) ? n.delete(f.chave) : n.add(f.chave);
                      return n;
                    });
                    setPagina(1);
                  }} />
                <span className="min-w-0 flex-1">{f.rotulo}</span>
                <span className="tabular-nums text-muted-foreground">{contagem[f.chave]}</span>
              </label>
            ))}
          </PopoverContent>
        </Popover>

        {/* Filial muda o tipo de trabalho: grupo se resolve junto, cliente
            solto se resolve sozinho. Separar os dois montes é o que permite
            atacar um de cada vez. */}
        {/* O que o portal deixou de informar. No Hiperador só o custo é
            esperado; nas centrais, MRR e custo. */}
        <select value={valorHiper} onChange={(e) => { setValorHiper(e.target.value); setPagina(1); }}
          className="h-9 rounded-md border bg-background px-3 text-sm">
          <option value="todos">Com e sem valor do Hiper</option>
          <option value="sem">Sem valor do Hiper ({num(qtdSemValor)})</option>
          <option value="com">Só com valor do Hiper</option>
        </select>

        <select value={comFilial} onChange={(e) => { setComFilial(e.target.value); setPagina(1); }}
          className="h-9 rounded-md border bg-background px-3 text-sm">
          <option value="todas">Com e sem filial</option>
          <option value="com">Só com filial</option>
          <option value="sem">Só sem filial</option>
        </select>

        {/* Tipo de contrato como botões, não lista: são três e cada um manda
            numa regra de dinheiro diferente — precisam estar à vista, não
            escondidos atrás de um clique. */}
        <div className="flex items-center rounded-md border p-0.5">
          {["hiper", "central_cobranca", "central_leads"].map((t) => {
            const ligado = tipos.has(t);
            return (
              <button key={t} type="button"
                title={TIPO_CONTRATO[t]?.explica}
                onClick={() => {
                  setTipos((s) => {
                    const n = new Set(s);
                    n.has(t) ? n.delete(t) : n.add(t);
                    return n;
                  });
                  setPagina(1);
                }}
                className={`rounded px-2.5 py-1 text-sm transition-colors ${
                  ligado ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                }`}>
                {nomeTipo(t)}
                {porTipo[t] != null && (
                  <span className="ml-1.5 tabular-nums opacity-70">{num(porTipo[t])}</span>
                )}
              </button>
            );
          })}
        </div>
        <span className="text-sm text-muted-foreground ml-auto">
          {buscando
            ? <>{num(linhas.length)} {linhas.length === 1 ? "cliente" : "clientes"} na busca</>
            : <>{num(linhas.length)} clientes · página {paginaAtual} de {num(paginas)}</>}
        </span>
      </div>

      {familias.size === 1 && META[Array.from(familias)[0]] && (
        <p className="text-xs text-muted-foreground px-1">{META[Array.from(familias)[0]].explica}</p>
      )}

      {/* Selecionar tudo o que está filtrado + o que fazer com a seleção. Fica
          acima da lista porque é daqui que se decide o lote. */}
      {linhas.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox"
              checked={selecionaveis.length > 0 && selecionaveis.every((l) => selecionados.has(l.id))}
              ref={(el) => { if (el) el.indeterminate =
                selecionados.size > 0 && !selecionaveis.every((l) => selecionados.has(l.id)); }}
              onChange={(e) => setSelecionados(e.target.checked
                ? new Set(selecionaveis.map((l) => l.id)) : new Set())} />
            Selecionar {num(selecionaveis.length)} com correção automática
          </label>
          {selecionados.size > 0 && (
            <>
              <span className="text-muted-foreground">{num(selecionados.size)} selecionados</span>
              <Button size="sm" onClick={() => {
                const escolhidos = linhas.filter((l) => selecionados.has(l.id));
                setConfirmar({
                  linhas: escolhidos,
                  // Começa com tudo o que dá, e o dinheiro fica visível para
                  // desmarcar: atualizar só o custo é caso comum.
                  escolhidas: new Set(escolhidos.flatMap(acoesDe)),
                });
              }}>
                <Wand2 className="h-3 w-3" /> Atualizar {num(selecionados.size)}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelecionados(new Set())}>
                Limpar seleção
              </Button>
            </>
          )}
        </div>
      )}

      {linhas.length === 0 ? (
        <Vazio>
          {recon.length === 0
            ? <>O espelho ainda não foi puxado. Vá em <strong>Sincronização</strong>.</>
            : "Nada pendente com esses filtros."}
        </Vazio>
      ) : (
        <div className="rounded-lg border divide-y">
          {visiveis.map((r) => {
            const abertoAqui = aberta === r.id;
            const nome = r.razao_social_ds ?? r.razao_social_hiper ?? "—";
            const fil = (r.detalhe?.filiais ?? {}) as any;
            const mods = (r.detalhe?.modulos ?? {}) as any;
            const aplicaveis = acoesDe(r);
            const grupo = (fil.grupo ?? []) as any[];
            return (
              <div key={r.id} className={selecionados.has(r.id) ? "bg-primary/5" : undefined}>
                <div className="flex items-start gap-2 pl-3">
                  <input type="checkbox" className="mt-3.5 shrink-0"
                    disabled={aplicaveis.length === 0}
                    title={aplicaveis.length === 0
                      ? "Nada nesta linha pode ser gravado automaticamente"
                      : undefined}
                    checked={selecionados.has(r.id)}
                    onChange={() => alternar(r.id)} />
                <button type="button" onClick={() => setAberta(abertoAqui ? null : r.id)}
                  className="flex w-full items-start gap-3 py-3 pr-3 text-left hover:bg-muted/30 transition-colors">
                  <ChevronRight className={`h-4 w-4 mt-0.5 shrink-0 text-muted-foreground transition-transform ${abertoAqui ? "rotate-90" : ""}`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">
                      {r.codigo_sequencial_ds != null && (
                        <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
                          {r.codigo_sequencial_ds}
                        </span>
                      )}
                      {nome}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {cnpjMask(r.cnpj_norm ?? r.cnpj_ds)} · {nomeTipo(r.responsavel_tipo)}
                      {r.situacao_hiper && ` · ${r.situacao_hiper} no Hiper`}
                      {rotuloRecorrencia(r.recorrencia_ds) && ` · ${rotuloRecorrencia(r.recorrencia_ds)}`}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {grupo.length > 0 && (
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {grupo.length === 1 ? "1 filial" : `${grupo.length} filiais`}
                        </Badge>
                      )}
                      {r.divergencias.map((d) => (
                        <Badge key={d} variant="secondary" className="text-[10px] font-normal">
                          {META[d]?.rotulo ?? d}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {r.status_usuario !== "pendente" && (
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {r.status_usuario === "resolvido" ? "Resolvida" : "Ignorada"}
                    </Badge>
                  )}
                </button>
                </div>

                {abertoAqui && (
                  <div className="border-t bg-muted/20 p-4 space-y-4 text-sm">
                    {/* Tudo por MÊS, que é a unidade dos dois lados e a que o MRR
                        do sistema soma. O ano vem embaixo, calculado — é ele que
                        deixa ver de relance que os dois lados estão de acordo. */}
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Mensalidade <Origem lado="ds" /></p>
                        <p className="tabular-nums font-medium">{brl(r.mensalidade_ds)}</p>
                        <p className="text-[10px] text-muted-foreground">{brl(anual(r.mensalidade_ds))} no ano</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">MRR <Origem lado="hiper" /></p>
                        <p className="tabular-nums font-medium">
                          {r.mrr_hiper != null ? brl(r.mrr_hiper)
                            : r.responsavel_tipo === "hiper"
                            // No Hiperador é assim mesmo: quem cobra é você.
                            ? <span className="text-muted-foreground font-normal">o portal não sabe o preço</span>
                            // Nas centrais, vazio é ausência de dado — dizer a
                            // mesma frase aqui seria mentira.
                            : <span className="text-muted-foreground font-normal">o portal não enviou o valor do mês</span>}
                        </p>
                        {r.mrr_hiper != null && (
                          <p className="text-[10px] text-muted-foreground">
                            {(r.divisor_periodo ?? 1) > 1
                              // O portal cobra o período de uma vez; aqui o campo
                              // é mensal. A conta fica à vista para ninguém achar
                              // que o número foi inventado.
                              ? `${brl(Number(r.mrr_hiper) * (r.divisor_periodo ?? 1))} cobrados de uma vez ÷ ${r.divisor_periodo}`
                              : `${brl(anual(r.mrr_hiper))} no ano`}
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Custo <Origem lado="ds" /></p>
                        <p className="tabular-nums font-medium">{brl(r.custo_ds)}</p>
                        <p className="text-[10px] text-muted-foreground">{brl(anual(r.custo_ds))} no ano</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Custo <Origem lado="hiper" /></p>
                        <p className="tabular-nums font-medium">
                          {r.custo_hiper == null ? "—" : brl(r.custo_hiper)}
                        </p>
                        {r.custo_hiper != null && (
                          <p className="text-[10px] text-muted-foreground">
                            {(r.divisor_periodo ?? 1) > 1
                              ? `${brl(Number(r.custo_hiper) * (r.divisor_periodo ?? 1))} cobrados de uma vez ÷ ${r.divisor_periodo}`
                              : `${brl(anual(r.custo_hiper))} no ano`}
                          </p>
                        )}
                      </div>
                    </div>

                    {r.divergencias.includes("valor_pode_ser_do_periodo") && (
                      <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                        <p className="font-medium text-amber-600 dark:text-amber-400">
                          O portal cobra {brl(r.mrr_hiper)} e aqui está {brl(r.mensalidade_ds)}
                        </p>
                        <p className="text-muted-foreground mt-1">
                          Diferença de {((Number(r.mrr_hiper) || 0) / (Number(r.mensalidade_ds) || 1)).toFixed(0)}×.
                          Isso quase nunca é cadastro errado — é o cliente pagando o período inteiro de uma
                          vez, com o portal lançando tudo num mês só. O contrato aqui está como{" "}
                          <strong>{r.recorrencia_ds ?? "mensal"}</strong>. Corrija a recorrência na ficha
                          e sincronize: o sistema passa a dividir pelo período sozinho. Até lá o valor não
                          é comparado nem gravado — aplicar multiplicaria o MRR deste cliente.
                        </p>
                      </div>
                    )}

                    {r.divergencias.includes("tipo_contrato_ausente") && (
                      <p className="text-muted-foreground">
                        O portal diz <strong>{nomeTipo(r.responsavel_tipo)}</strong> e o contrato aqui
                        está sem modelo. Defina o modelo na ficha do cliente — enquanto isso, nenhuma
                        regra de valor se aplica a ele.
                      </p>
                    )}
                    {r.divergencias.includes("tipo_contrato_divergente") && (
                      <p className="text-muted-foreground">
                        O portal diz <strong>{nomeTipo(r.responsavel_tipo)}</strong>; aqui está{" "}
                        <strong>{r.modelo_contrato_ds ?? "—"}</strong>.
                      </p>
                    )}

                    {/* O grupo aparece esteja certo ou errado: sem isso, uma
                        matriz com filial em ordem não mostra nada e parece que
                        as filiais não existem no sistema. */}
                    {grupo.length > 0 && (
                      <div>
                        <p className="font-medium mb-1">
                          Filiais do grupo · matriz {r.codigo_sequencial_ds ?? "—"}
                        </p>
                        <div className="space-y-1">
                          {grupo.map((f: any) => (
                            <div key={f.cnpj} className="flex flex-wrap items-center gap-2 rounded border bg-background px-2 py-1.5">
                              {f.codigo != null && (
                                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
                                  {f.codigo}
                                </span>
                              )}
                              <span className="min-w-0 flex-1 truncate">{f.nome}</span>
                              <span className="text-xs text-muted-foreground">{cnpjMask(f.cnpj)}</span>
                              <Badge variant={f.estado === "ok" ? "outline" : "secondary"}
                                className={`text-[10px] ${f.estado === "ok" ? "text-emerald-600 dark:text-emerald-400 border-emerald-600/30" : ""}`}>
                                {f.estado === "ok" ? "confere"
                                  : f.estado === "faltando" ? "só no Hiper"
                                  : f.estado === "sem_matriz" ? "matriz errada"
                                  : f.estado === "paga_propria" ? "paga a própria conta"
                                  : "com valor próprio"}
                              </Badge>
                              {f.cliente_id && (
                                <a href={`/clientes/${f.cliente_id}`} target="_blank" rel="noreferrer"
                                  className="text-muted-foreground hover:text-foreground" title="Abrir cadastro">
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {Array.isArray(fil.faltando) && fil.faltando.length > 0 && (
                      <div>
                        <p className="font-medium mb-1">Filiais que só existem no Hiper</p>
                        <ul className="space-y-0.5 text-muted-foreground">
                          {fil.faltando.map((f: any) => (
                            <li key={f.cnpj}>{cnpjMask(f.cnpj)} — {f.nome}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {Array.isArray(fil.com_valor) && fil.com_valor.length > 0 && (
                      <div>
                        <p className="font-medium mb-1">
                          Filiais com valor próprio ({brl(fil.com_valor.reduce((a: number, f: any) => a + Number(f.mrr ?? 0), 0))} no total)
                        </p>
                        <p className="text-xs text-muted-foreground mb-2">
                          Se a matriz já carrega o total do grupo, este valor está sendo contado duas
                          vezes. Se a filial paga a própria conta, registre — e ela para de aparecer.
                        </p>
                        <div className="space-y-1.5">
                          {fil.com_valor.map((f: any) => (
                            <div key={f.cliente_id} className="flex flex-wrap items-center gap-2 rounded border bg-background px-2 py-1.5">
                              <span className="min-w-0 flex-1 truncate">{f.nome}</span>
                              <span className="tabular-nums text-xs">{brl(f.mrr)} MRR · {brl(f.custo)} custo</span>
                              <Button size="sm" variant="outline" disabled={ocupado === f.cliente_id}
                                onClick={() => decidirFilial(f.cliente_id, "paga_propria_conta")}>
                                {ocupado === f.cliente_id && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                                Paga a própria conta
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {Array.isArray(fil.conta_propria) && fil.conta_propria.length > 0 && (
                      <div>
                        <p className="font-medium mb-1">Amarradas como filial, mas são conta própria no Hiper</p>
                        <div className="space-y-1.5">
                          {fil.conta_propria.map((f: any) => (
                            <div key={f.cliente_id} className="flex flex-wrap items-center gap-2 rounded border bg-background px-2 py-1.5">
                              <span className="min-w-0 flex-1 truncate">{f.nome} · {cnpjMask(f.cnpj)}</span>
                              <Button size="sm" variant="outline" disabled={ocupado === f.cliente_id}
                                onClick={() => decidirFilial(f.cliente_id, "cliente_proprio")}>
                                Tratar como cliente próprio
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {Array.isArray(fil.sem_matriz) && fil.sem_matriz.length > 0 && (
                      <div>
                        <p className="font-medium mb-1">Filiais sem a matriz certa</p>
                        <ul className="space-y-0.5 text-muted-foreground">
                          {fil.sem_matriz.map((f: any) => (
                            <li key={f.cliente_id}>{f.nome} — {cnpjMask(f.cnpj)}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {Array.isArray(fil.duplicado) && fil.duplicado.length > 0 && (
                      <div>
                        <p className="font-medium mb-1">Cadastro repetido (mesmo CNPJ da matriz)</p>
                        <ul className="space-y-0.5 text-muted-foreground">
                          {fil.duplicado.map((f: any) => <li key={f.cliente_id}>{f.nome}</li>)}
                        </ul>
                      </div>
                    )}

                    {(mods.a_mais || mods.a_menos || mods.custo || mods.quantidade) && (
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {mods.a_mais && (
                          <div>
                            <p className="font-medium mb-1">Falta no contrato</p>
                            <ul className="text-muted-foreground space-y-0.5">
                              {mods.a_mais.map((m: any) => (
                                <li key={m.nome}>
                                  {m.qtd > 1 && `${m.qtd}× `}{m.nome} · {brl(m.custo)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {mods.quantidade && (
                          <div>
                            <p className="font-medium mb-1">Quantidade diferente</p>
                            <ul className="text-muted-foreground space-y-0.5">
                              {mods.quantidade.map((m: any) => (
                                <li key={m.nome}>{m.nome}: {m.ds} aqui · {m.hiper} lá</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {mods.a_menos && (
                          <div>
                            <p className="font-medium mb-1">Só aqui</p>
                            <ul className="text-muted-foreground space-y-0.5">
                              {mods.a_menos.map((m: any) => <li key={m.nome}>{m.nome} · {brl(m.custo)}</li>)}
                            </ul>
                          </div>
                        )}
                        {mods.custo && (
                          <div>
                            <p className="font-medium mb-1">Custo diferente</p>
                            <ul className="text-muted-foreground space-y-0.5">
                              {mods.custo.map((m: any) => (
                                <li key={m.nome}>{m.nome}: {brl(m.ds)} aqui · {brl(m.hiper)} lá</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {aplicaveis.length > 0 && (
                        <Button size="sm" disabled={!!ocupado}
                          onClick={() => setConfirmar({ linhas: [r], escolhidas: new Set(aplicaveis) })}>
                          {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                          Atualizar no DoctorSaaS
                          {aplicaveis.length > 1 && ` (${aplicaveis.length})`}
                        </Button>
                      )}

                      {r.id_portal && (
                        <Button size="sm" variant="outline" disabled={!!ocupado}
                          onClick={() => rebuscar(r.id_portal as string)}>
                          {ocupado === `portal-${r.id_portal}`
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <RefreshCw className="h-3 w-3" />}
                          Rebuscar no portal
                        </Button>
                      )}

                      {/* Nova aba de propósito: a lista de divergências costuma ser
                          percorrida inteira, e navegar para fora perderia o lugar. */}
                      {r.ds_cliente_id && (
                        <Button asChild size="sm" variant="outline">
                          <a href={`/clientes/${r.ds_cliente_id}`} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-3 w-3" /> Abrir cadastro
                          </a>
                        </Button>
                      )}

                      {r.status_usuario === "pendente" ? (
                        <>
                          <Button size="sm" variant="ghost" disabled={ocupado === r.id}
                            onClick={() => marcar(r.id, "resolvido")}>
                            <Check className="h-3 w-3" /> Já resolvi por fora
                          </Button>
                          <Button size="sm" variant="ghost" disabled={ocupado === r.id}
                            onClick={() => marcar(r.id, "ignorado")}>
                            <EyeOff className="h-3 w-3" /> Ignorar
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" disabled={ocupado === r.id}
                          onClick={() => marcar(r.id, "pendente")}>
                          Reabrir
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <strong>Atualizar</strong> grava no cadastro daqui o que o portal diz.{" "}
                      <strong>Já resolvi por fora</strong> e <strong>Ignorar</strong> não mexem em
                      nada: só tiram a linha da lista, e ela volta sozinha se o conjunto de
                      divergências deste cliente mudar no próximo espelho.
                      {aplicaveis.length === 0 && (
                        <> Nesta linha não há o que gravar automaticamente — filial mexe na árvore
                        de cadastro e conta sem dono não tem onde escrever.</>
                      )}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
          {!buscando && paginas > 1 && (
            <div className="flex items-center justify-between gap-2 p-3 text-sm">
              <Button variant="outline" size="sm" disabled={paginaAtual <= 1}
                onClick={() => setPagina(paginaAtual - 1)}>Anterior</Button>
              <span className="text-muted-foreground">
                {num((paginaAtual - 1) * POR_PAGINA + 1)}–{num(Math.min(paginaAtual * POR_PAGINA, linhas.length))}{" "}
                de {num(linhas.length)}
              </span>
              <Button variant="outline" size="sm" disabled={paginaAtual >= paginas}
                onClick={() => setPagina(paginaAtual + 1)}>Próxima</Button>
            </div>
          )}
        </div>
      )}

      {/* Confirmação com o antes e o depois de CADA campo. O botão é um clique,
          mas nenhum valor muda sem estar escrito na tela primeiro. */}
      {/* Cada ação é uma caixa. Atualizar só o custo e deixar a mensalidade de
          fora é caso comum, e antes era tudo-ou-nada. */}
      <AlertDialog open={!!confirmar} onOpenChange={(o) => !o && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmar && confirmar.linhas.length === 1
                ? `Atualizar ${confirmar.linhas[0].razao_social_ds ?? confirmar.linhas[0].razao_social_hiper}`
                : `Atualizar ${num(confirmar?.linhas.length)} clientes`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>Escolha o que o cadastro daqui passa a ter do portal:</p>
                <ul className="space-y-2">
                  {ACOES.filter((a) => confirmar?.linhas.some((l) => acoesDe(l).includes(a.acao)))
                    .map((a) => {
                      const alvo = confirmar!.linhas.filter((l) => acoesDe(l).includes(a.acao));
                      const marcada = confirmar!.escolhidas.has(a.acao);
                      return (
                        <li key={a.acao} className="rounded border bg-muted/40 px-2.5 py-2">
                          <label className="flex items-start gap-2 cursor-pointer">
                            <input type="checkbox" className="mt-1 shrink-0" checked={marcada}
                              onChange={() => setConfirmar((c) => {
                                if (!c) return c;
                                const e = new Set(c.escolhidas);
                                e.has(a.acao) ? e.delete(a.acao) : e.add(a.acao);
                                return { ...c, escolhidas: e };
                              })} />
                            <span className="min-w-0">
                              <span className="font-medium text-foreground">{a.rotulo}</span>
                              <span className="text-foreground">
                                {confirmar!.linhas.length === 1
                                  ? ` — ${a.detalhe(confirmar!.linhas[0])}`
                                  : ` — ${num(alvo.length)} ${alvo.length === 1 ? "cliente" : "clientes"}`}
                              </span>
                              {a.efeito && <span className="block text-xs mt-0.5">{a.efeito}</span>}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                </ul>
                <p className="text-xs">
                  Quem não puder receber uma dessas — contrato anual, mais de um contrato Hiper —
                  é pulado com o motivo, e o resto grava normalmente.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={!!ocupado || !confirmar?.escolhidas.size}
              onClick={(e) => { e.preventDefault(); aplicar(); }}>
              {ocupado && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Atualizar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
