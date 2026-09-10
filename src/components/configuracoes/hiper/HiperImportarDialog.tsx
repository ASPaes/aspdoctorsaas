import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useLookups } from "@/hooks/useLookups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle, ChevronDown, ChevronRight, ExternalLink, Loader2, Download,
} from "lucide-react";
import { maskPhoneBR } from "@/lib/masks";
import { brl, cnpjMask, nomeTipo, num, rotuloRecorrencia } from "./ui";
import {
  TETO_LOTE, contaVazia, entraramComCerteza, fatiar, mensalidadeOk, prontasParaEnviar,
  recorrenciaDoPlano, semearConta, separarContas, separarFaixas, telefoneEhFixo,
  type ContatoEspelho, type JaCadastrado, type PorConta,
} from "./importarRegras";
import type { LinhaRecon } from "./useHiperDados";

/**
 * Importar para o DoctorSaaS as contas que vivem no portal Hiper e não têm
 * cadastro aqui.
 *
 * O portal dá razão social, fantasia, CNPJ, cidade/UF, plano, tipo de contrato,
 * custo — e, desde 10/09/2026, também e-mail e telefone, que a tela pedia à mão.
 *
 * O que ele não dá é a mensalidade, e não dá por um motivo: nas contas de
 * Hiperador quem cobra o cliente é a revenda. Medido nas 998 do espelho, só
 * contas ativas: Hiperador tem 0 preços em 352; Central tem 249 em 268. É essa
 * assimetria que divide a tela em duas faixas — uma que não pede nada e outra
 * que é uma lista de trabalho, preenchida aos poucos.
 */

export default function HiperImportarDialog({
  tid, contas, open, onOpenChange,
}: {
  tid: string | null;
  contas: LinhaRecon[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const lookups = useLookups();

  const [unidade, setUnidade] = useState("");
  const [origem, setOrigem] = useState("");
  const [vendedor, setVendedor] = useState("");
  const [forma, setForma] = useState("");
  const [dia, setDia] = useState("");
  const [dataInicio, setDataInicio] = useState(() => new Date().toISOString().slice(0, 10));
  const [porConta, setPorConta] = useState<Record<string, PorConta>>({});
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [aberta, setAberta] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState<{ feitas: number; total: number } | null>(null);
  /** Quem já entrou nesta sessão. Some da lista sem esperar refetch. */
  const [importados, setImportados] = useState<Set<string>>(new Set());

  const cnpjs = useMemo(
    () => contas.map((c) => c.cnpj_norm).filter((c): c is string => !!c),
    [contas],
  );

  /**
   * Quem já tem cadastro aqui. A reconciliação chama de "sem cliente" a conta
   * cujo cadastro não tem NENHUM contrato ativo do fornecedor Hiper — e um
   * cliente cancelado, sem produto, é exatamente isso. Criar outro duplicaria a
   * base, então essas contas saem do lote e a tela diz qual cadastro é.
   */
  // `isLoading` no lugar de `isPending`: no React Query v5 o segundo é true
  // também para query DESLIGADA. Uma conta que o portal manda sem CNPJ desliga
  // esta busca, e o diálogo ficava preso em "Conferindo…" para sempre —
  // justamente a conta que precisava aparecer para ser corrigida.
  const { data: existentes, isLoading: checando } = useQuery({
    queryKey: ["hiper_importar_existentes", tid, cnpjs.join(",")],
    enabled: open && !!tid && cnpjs.length > 0,
    queryFn: async (): Promise<JaCadastrado[]> => {
      const { data, error } = await supabase
        .from("clientes")
        .select("id, codigo_sequencial, razao_social, cancelado, cnpj_digits")
        .eq("tenant_id", tid as string)
        .in("cnpj_digits", cnpjs);
      if (error) throw error;
      return (data ?? []) as any;
    },
  });

  /**
   * E-mail e telefone do espelho. A reconciliação não os carrega, mas o portal
   * entrega os dois: medido em 10/09/2026, 998 das 998 contas têm e-mail (100%
   * em formato válido) e 998 têm telefone. Pedir isso à mão, conta a conta, era
   * o que inviabilizava importar um lote grande.
   */
  const idsPortal = useMemo(
    () => contas.map((c) => c.id_portal).filter((p): p is string => !!p),
    [contas],
  );

  const { data: contatos, isLoading: buscandoContato } = useQuery({
    queryKey: ["hiper_importar_contatos", tid, idsPortal.join(",")],
    enabled: open && !!tid && idsPortal.length > 0,
    queryFn: async (): Promise<ContatoEspelho[]> => {
      const { data, error } = await (supabase.from("hiper_espelho_cadastro" as any) as any)
        .select("id_portal, email, contato_email, telefone, contato_telefone")
        .eq("tenant_id", tid as string)
        .in("id_portal", idsPortal);
      if (error) throw error;
      return (data ?? []) as ContatoEspelho[];
    },
  });

  const porPortal = useMemo(() => {
    const m = new Map<string, ContatoEspelho>();
    for (const c of contatos ?? []) m.set(c.id_portal, c);
    return m;
  }, [contatos]);

  const checandoTudo = checando || buscandoContato;

  const { mapa: mapaExistente, novas: todasNovas, bloqueadas } = useMemo(
    () => separarContas(contas, existentes ?? []), [contas, existentes]);

  // O que já entrou nesta sessão sai da lista: é o que faz "importar aos
  // poucos" parecer trabalho andando, sem esperar a reconciliação voltar.
  const novas = useMemo(
    () => todasNovas.filter((c) => !importados.has(c.id)), [todasNovas, importados]);

  const { prontas, faltaValor } = useMemo(() => separarFaixas(novas), [novas]);

  /**
   * Semeia com o que o portal sabe. Espera o contato chegar: semear antes
   * gravaria vazio em `porConta`, e a guarda `!novo[c.id]` — que existe para
   * não apagar o que a pessoa digitou — impediria o preenchimento depois.
   */
  useEffect(() => {
    if (!open || buscandoContato) return;
    setPorConta((atual) => {
      let mudou = false;
      const novo = { ...atual };
      for (const c of contas) {
        if (novo[c.id]) continue;
        novo[c.id] = semearConta(c, c.id_portal ? porPortal.get(c.id_portal) : undefined);
        mudou = true;
      }
      // Devolver objeto novo sem ter mudado nada re-renderiza, o que refaz as
      // dependências do efeito, que roda de novo: laço infinito.
      return mudou ? novo : atual;
    });
  }, [open, contas, buscandoContato, porPortal]);

  /**
   * A faixa automática nasce toda marcada; a manual, nenhuma. Marcar a manual
   * junto ofereceria "importar" um monte que ainda não tem preço, e o botão
   * ficaria cinza sem a pessoa entender por quê.
   */
  const marcacaoInicial = useRef(false);
  useEffect(() => {
    if (!open) { marcacaoInicial.current = false; return; }
    if (checandoTudo || marcacaoInicial.current) return;
    // Uma vez por abertura. Reagir a `prontas` sem essa trava desmarcaria de
    // volta o que a pessoa acabou de desmarcar.
    marcacaoInicial.current = true;
    setMarcadas(new Set(prontas.map((c) => c.id)));
  }, [open, checandoTudo, prontas]);

  const editar = (id: string, campo: keyof PorConta, valor: string) =>
    setPorConta((s) => ({ ...s, [id]: { ...(s[id] ?? contaVazia), [campo]: valor } }));

  const alternar = (id: string) =>
    setMarcadas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const alternarFaixa = (faixa: LinhaRecon[], ligar: boolean) =>
    setMarcadas((s) => {
      const n = new Set(s);
      for (const c of faixa) { if (ligar) n.add(c.id); else n.delete(c.id); }
      return n;
    });

  const alvo = useMemo(
    () => prontasParaEnviar(novas, porConta, marcadas), [novas, porConta, marcadas]);
  const marcadasIncompletas = useMemo(
    () => novas.filter((c) => marcadas.has(c.id)).length - alvo.length, [novas, marcadas, alvo]);

  const padraoOk = !!unidade && !!dataInicio;
  const podeEnviar = padraoOk && !checandoTudo && alvo.length > 0 && !enviando;

  /**
   * Envia em chamadas do tamanho que a RPC aceita (200). Uma chamada que falha
   * não cancela as seguintes: cada uma é sua própria transação e tem seu
   * `lote_id`, e o resumo diz qual delas não passou. Perder 200 contas boas
   * porque a 3ª fatia teve um problema seria pior do que continuar.
   */
  const importar = async () => {
    setEnviando(true);
    const fatias = fatiar(alvo);
    setProgresso({ feitas: 0, total: fatias.length });

    const criados: any[] = [];
    const recusados: { conta: string; motivo: string }[] = [];
    const entraram = new Set<string>();

    for (let i = 0; i < fatias.length; i++) {
      const fatia = fatias[i];
      try {
        const { data, error } = await supabase.rpc("hiper_importar_contas" as any, {
          p_tenant_id: tid,
          p_padrao: {
            unidade_base_id: unidade,
            origem_venda_id: origem || null,
            funcionario_id: vendedor || null,
            forma_pagamento_mensalidade_id: forma || null,
            dia_vencimento: dia || null,
            data_inicio: dataInicio,
          },
          p_itens: fatia.map((c) => {
            const d = porConta[c.id] ?? contaVazia;
            return {
              id_portal: c.id_portal,
              mensalidade: d.mensalidade.replace(",", "."),
              email: d.email.trim(),
              whatsapp: d.whatsapp,
              area_atuacao_id: d.area_atuacao_id || null,
              segmento_id: d.segmento_id || null,
            };
          }),
        } as any);
        if (error) throw error;
        const r = data as any;
        if (!r?.ok) throw new Error(r?.erro || "Não foi possível importar.");

        const feitos = (r.criados ?? []) as any[];
        criados.push(...feitos);
        recusados.push(...((r.recusados ?? []) as any[]));
        for (const id of entraramComCerteza(fatia, feitos)) entraram.add(id);
      } catch (e: any) {
        recusados.push({
          conta: `lote ${i + 1} de ${fatias.length} (${fatia.length} contas)`,
          motivo: e.message,
        });
      }
      setProgresso({ feitas: i + 1, total: fatias.length });
    }

    setImportados((s) => new Set([...s, ...entraram]));
    setMarcadas((s) => new Set([...s].filter((id) => !entraram.has(id))));

    toast({
      title: criados.length === 0
        ? "Nenhuma conta foi importada"
        : `${num(criados.length)} ${criados.length === 1 ? "cliente criado" : "clientes criados"}`,
      // O recusado importa tanto quanto o criado: sem isso a pessoa acha que
      // importou 800 e importou 780.
      description: recusados.length
        ? `Não entraram: ${recusados.map((x) => `${x.conta} (${x.motivo})`).join(" · ")}`
        : "Contrato, custo e módulos vieram junto.",
      variant: criados.length === 0 ? "destructive" : undefined,
    });

    ["hiper_recon", "hiper_log", "clientes"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    setProgresso(null);
    setEnviando(false);
    // Fecha só quando não sobrou trabalho. Na faixa manual o ciclo é preencher
    // um punhado, mandar e continuar — fechar a cada rodada faria recomeçar.
    if (criados.length > 0 && todasNovas.length === importados.size + entraram.size) {
      onOpenChange(false);
    }
  };

  const selectCls = "h-9 w-full rounded-md border bg-background px-3 text-sm";

  /**
   * A linha de uma conta. Função que devolve JSX, e NÃO um componente declarado
   * aqui dentro: componente definido no corpo do pai vira um tipo novo a cada
   * render, o React remonta a linha inteira e o campo de mensalidade perde o
   * foco a cada tecla digitada.
   */
  const linha = (c: LinhaRecon, pedeValor: boolean) => {
    const d = porConta[c.id] ?? contaVazia;
    const expandida = aberta === c.id;
    const completa = mensalidadeOk(d.mensalidade);
    return (
      <div key={c.id} className="rounded-lg border bg-background">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
          <input type="checkbox" className="shrink-0" checked={marcadas.has(c.id)}
            onChange={() => alternar(c.id)} aria-label={`Selecionar ${c.razao_social_hiper}`} />

          <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setAberta(expandida ? null : c.id)}
            aria-label={expandida ? "Fechar detalhes" : "Ver e-mail, WhatsApp e classificação"}>
            {expandida ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="truncate text-sm font-medium">{c.razao_social_hiper}</span>
              <span className="font-mono text-xs text-muted-foreground">{cnpjMask(c.cnpj_norm)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1 pt-0.5">
              <Badge variant="secondary" className="text-[10px]">{c.plano_hiper}</Badge>
              <Badge variant="outline" className="text-[10px]">{nomeTipo(c.responsavel_tipo)}</Badge>
              {/* A recorrência sai do NOME do plano e precisa estar à vista: é
                  ela que evita o contrato anual entrar como mensal. */}
              {recorrenciaDoPlano(c.plano_hiper) !== "mensal" && (
                <Badge variant="outline" className="text-[10px]">
                  {rotuloRecorrencia(recorrenciaDoPlano(c.plano_hiper))}
                </Badge>
              )}
              {telefoneEhFixo(d.whatsapp) && (
                <Badge variant="outline" className="border-amber-500/50 text-[10px] text-amber-500">
                  telefone fixo
                </Badge>
              )}
            </div>
          </div>

          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            custo {brl(c.custo_hiper)}/mês
          </span>

          <div className="w-32 shrink-0">
            {pedeValor ? (
              <Input className="h-8 tabular-nums" inputMode="decimal" placeholder="mensalidade"
                value={d.mensalidade} onChange={(e) => editar(c.id, "mensalidade", e.target.value)} />
            ) : (
              <span className="block text-right text-sm font-medium tabular-nums">
                {brl(Number(d.mensalidade || 0))}
              </span>
            )}
          </div>
        </div>

        {expandida && (
          <div className="grid gap-3 border-t px-3 py-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">E-mail *</Label>
              <Input className="h-9" type="email" placeholder="cliente@empresa.com.br"
                value={d.email} onChange={(e) => editar(c.id, "email", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">WhatsApp *</Label>
              <Input className="h-9" placeholder="(47) 99999-9999" value={d.whatsapp}
                onChange={(e) => editar(c.id, "whatsapp", maskPhoneBR(e.target.value))} />
              {/* 472 dos 998 telefones do espelho são fixo. Avisar aqui, e não
                  na hora de mandar a primeira mensagem. */}
              {telefoneEhFixo(d.whatsapp) && (
                <p className="text-[11px] text-amber-500">
                  O portal deu um telefone fixo — confira se tem WhatsApp.
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Área de atuação</Label>
              <select className={selectCls} value={d.area_atuacao_id}
                onChange={(e) => editar(c.id, "area_atuacao_id", e.target.value)}>
                <option value="">—</option>
                {(lookups.areasAtuacao.data ?? []).map((a: any) => (
                  <option key={a.id} value={a.id}>{a.nome}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Segmento</Label>
              <select className={selectCls} value={d.segmento_id}
                onChange={(e) => editar(c.id, "segmento_id", e.target.value)}>
                <option value="">—</option>
                {(lookups.segmentos.data ?? []).map((s: any) => (
                  <option key={s.id} value={s.id}>{s.nome}</option>
                ))}
              </select>
            </div>
            {pedeValor && !completa && (
              <p className="text-[11px] text-muted-foreground lg:col-span-4">
                O portal não informa o preço desta conta: aqui quem cobra o cliente é você.
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  const cabecalho = (titulo: string, explica: string, faixa: LinhaRecon[]) => {
    const todasMarcadas = faixa.every((c) => marcadas.has(c.id));
    return (
      <div key={titulo} className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2">
        <input type="checkbox" checked={todasMarcadas}
          onChange={() => alternarFaixa(faixa, !todasMarcadas)}
          aria-label={`Selecionar todas de ${titulo}`} />
        <span className="text-sm font-medium">{titulo} ({num(faixa.length)})</span>
        <span className="text-xs text-muted-foreground">{explica}</span>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !enviando && onOpenChange(o)}>
      <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="m-0 shrink-0 border-b px-6 pt-6 pb-4">
          <DialogTitle>
            {checandoTudo
              ? "Importar contas do Hiper"
              : `Importar ${num(novas.length)} ${novas.length === 1 ? "conta" : "contas"} do Hiper`}
          </DialogTitle>
          <DialogDescription>
            Razão social, CNPJ, cidade, plano, tipo de contrato, custo, e-mail e telefone
            vêm do portal. O que ele não tem é preenchido aqui. Fornecedor:{" "}
            <strong className="text-foreground">Hiper Software</strong>, o mesmo da integração.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4">
          {checandoTudo && (
            <p className="flex items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Conferindo os CNPJs e buscando o contato no portal…
            </p>
          )}

          {!checandoTudo && (<>
          {/* ── o que vale para todas ─────────────────────────────────────── */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">Vale para todas as contas deste lote</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Unidade base *</Label>
                <select className={selectCls} value={unidade} onChange={(e) => setUnidade(e.target.value)}>
                  <option value="">Escolha…</option>
                  {(lookups.unidadesBase.data ?? [])
                    .filter((u: any) => u.is_active)
                    .map((u: any) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Origem da venda</Label>
                <select className={selectCls} value={origem} onChange={(e) => setOrigem(e.target.value)}>
                  <option value="">—</option>
                  {(lookups.origensVenda.data ?? []).map((o: any) => (
                    <option key={o.id} value={o.id}>{o.nome}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Vendedor responsável</Label>
                <select className={selectCls} value={vendedor} onChange={(e) => setVendedor(e.target.value)}>
                  <option value="">—</option>
                  {(lookups.funcionarios.data ?? []).map((f: any) => (
                    <option key={f.id} value={f.id}>{f.nome}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Forma de pagamento da mensalidade</Label>
                <select className={selectCls} value={forma} onChange={(e) => setForma(e.target.value)}>
                  <option value="">—</option>
                  {(lookups.formasPagamento.data ?? []).map((f: any) => (
                    <option key={f.id} value={f.id}>{f.nome}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Data de início *</Label>
                <Input type="date" className="h-9" value={dataInicio} max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setDataInicio(e.target.value)} />
                <p className="text-[11px] text-muted-foreground">
                  Vale como venda e ativação para todas — o portal não informa nenhuma das duas.
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Dia de vencimento</Label>
                <Input type="number" min={1} max={31} className="h-9" value={dia}
                  onChange={(e) => setDia(e.target.value)} placeholder="—" />
              </div>
            </div>
          </div>

          {/* ── faixa automática ──────────────────────────────────────────── */}
          {prontas.length > 0 && (<>
            {cabecalho("Pronta para importar",
              "Central de Cobrança e Leads: a Hiper cobra o cliente, então o portal sabe o preço. Nada a preencher.",
              prontas)}
            <div className="space-y-2">{prontas.map((c) => linha(c, false))}</div>
          </>)}

          {/* ── faixa manual ──────────────────────────────────────────────── */}
          {faltaValor.length > 0 && (<>
            {cabecalho("Falta a mensalidade",
              "No Hiperador quem cobra o cliente é você, e o portal não conhece o preço. Preencha quem souber e importe; o resto continua aqui.",
              faltaValor)}
            <div className="space-y-2">{faltaValor.map((c) => linha(c, true))}</div>
          </>)}

          {/* ── as que não entram, e por quê ──────────────────────────────── */}
          {bloqueadas.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
              <p className="flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                {num(bloqueadas.length)} {bloqueadas.length === 1 ? "conta fica" : "contas ficam"} de fora
              </p>
              <p className="text-xs text-muted-foreground">
                O CNPJ já tem cadastro aqui. A conta aparece como “sem cliente” porque esse
                cadastro não tem nenhum contrato ativo do Hiper — normalmente por estar
                cancelado. Importar criaria um cliente duplicado; o caminho é devolver o
                produto ao cadastro que já existe, pela ficha dele.
              </p>
              <ul className="space-y-1">
                {bloqueadas.map((c) => {
                  const donos = mapaExistente.get(c.cnpj_norm as string) ?? [];
                  return (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 rounded border bg-background px-2 py-1.5 text-xs">
                      <span className="min-w-0 flex-1 truncate">{c.razao_social_hiper}</span>
                      {donos.map((d) => (
                        <a key={d.id} href={`/clientes/${d.id}`} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono hover:underline">
                          #{d.codigo_sequencial ?? "—"}
                          {d.cancelado && <span className="text-muted-foreground">cancelado</span>}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ))}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {novas.length === 0 && (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {importados.size > 0
                ? "Tudo o que dava foi importado."
                : "Nenhuma das contas selecionadas pode virar cadastro novo."}
            </p>
          )}
          </>)}
        </div>

        <DialogFooter className="m-0 shrink-0 border-t px-6 py-4 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {progresso
              ? `Enviando lote ${num(progresso.feitas + (progresso.feitas < progresso.total ? 1 : 0))} de ${num(progresso.total)}…`
              : checandoTudo
              ? "Conferindo os CNPJs…"
              : !padraoOk
              ? "Escolha a unidade base e a data de início."
              : alvo.length === 0
                ? "Marque ao menos uma conta com a mensalidade preenchida."
                : marcadasIncompletas > 0
                  // Marcada e incompleta ficaria de fora em silêncio: pior do
                  // que dizer quantas são.
                  ? `${num(alvo.length)} vão nesta rodada · ${num(marcadasIncompletas)} marcadas ainda sem mensalidade`
                  : alvo.length > TETO_LOTE
                    ? `${num(alvo.length)} contas em ${num(fatiar(alvo).length)} envios de até ${num(TETO_LOTE)}`
                    : `${num(alvo.length)} ${alvo.length === 1 ? "conta vai" : "contas vão"} nesta rodada`}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviando}>Fechar</Button>
            <Button onClick={importar} disabled={!podeEnviar}>
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Importar{!checandoTudo && alvo.length > 0 && ` ${num(alvo.length)}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
