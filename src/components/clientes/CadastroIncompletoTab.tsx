import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useLookups } from "@/hooks/useLookups";
import { useCadastroIncompleto, type CampoIncompleto } from "@/hooks/useCadastroIncompleto";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, CalendarClock, ExternalLink, Loader2, MapPin, Wand2 } from "lucide-react";

/**
 * Saneamento de cadastro, por campo.
 *
 * Medido em 03/09: 74% dos clientes ativos têm alguma lacuna, e os campos de
 * segmentação que o dashboard usa estão vazios na maioria da base. Somando
 * tudo dá ~12 mil pendências — uma fila desse tamanho não é acionável, e é por
 * isso que a tela começa por CAMPO e não por cliente: "561 sem vendedor" é uma
 * tarefa; "589 clientes com pendência" não é.
 *
 * O caminho é sempre o mesmo: escolher o campo, filtrar até sobrar o grupo que
 * compartilha a mesma resposta, e preencher esse grupo de uma vez.
 */

const num = (v: number) => new Intl.NumberFormat("pt-BR").format(v);

type LinhaFalta = {
  registro_id: string;
  cliente_id: string;
  codigo: number | null;
  cliente_nome: string;
  /** O produto (ou o CEP, em cidade e estado) — o contexto do próprio campo. */
  detalhe: string;
  /** A unidade do cliente. Sem ela, escolher o vendedor é adivinhação. */
  unidade: string;
  /** Quando o cliente entrou: diz quem estava vendendo naquela época. */
  data_cadastro: string | null;
  total: number;
};

/**
 * Data como dd/mm/aaaa, marcando a que é impossível.
 *
 * Existem 40 clientes com data anterior a 2000 — 39 da Delvale entre 1906 e
 * 1933, todos com o mesmo dia e mês, e um do ASP em 0004. É erro de
 * importação, e contamina coorte, tempo de casa e early churn. Aqui a data
 * aparece destacada em vez de passar como se fosse verdade.
 */
const dataBR = (v: string | null) => {
  if (!v) return { texto: "—", suspeita: false };
  const d = new Date(`${v}T12:00:00`);
  if (Number.isNaN(d.getTime())) return { texto: v, suspeita: true };
  const ano = d.getFullYear();
  return {
    texto: d.toLocaleDateString("pt-BR"),
    suspeita: ano < 2000 || d > new Date(),
  };
};

export default function CadastroIncompletoTab() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { campos, carregando } = useCadastroIncompleto();
  const lookups = useLookups();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [campo, setCampo] = useState<CampoIncompleto | null>(null);
  const [busca, setBusca] = useState("");
  const [unidade, setUnidade] = useState("");
  const [produto, setProduto] = useState("");
  const [valor, setValor] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [gravando, setGravando] = useState(false);

  const limparFiltros = () => { setBusca(""); setUnidade(""); setProduto(""); setValor(""); setSel(new Set()); };

  const { data: linhas = [], isPending: listando } = useQuery({
    queryKey: ["cadastro_incompleto_lista", tid, campo?.campo, busca, unidade, produto],
    enabled: !!tid && !!campo,
    queryFn: async (): Promise<LinhaFalta[]> => {
      const { data, error } = await (supabase.rpc as any)("fn_cadastro_incompleto_lista", {
        p_tenant_id: tid,
        p_campo: campo!.campo,
        p_unidades: unidade ? [Number(unidade)] : null,
        p_produto_id: produto ? Number(produto) : null,
        p_busca: busca.trim() || null,
        p_limite: 300,
        p_offset: 0,
      });
      if (error) throw error;
      return (data ?? []) as LinhaFalta[];
    },
  });

  const total = linhas[0]?.total ?? 0;

  /** As opções do seletor de valor, conforme o campo escolhido. */
  const opcoes = useMemo(() => {
    if (!campo) return [] as { id: string; nome: string }[];
    const mapa: Record<string, { id: any; nome: string }[]> = {
      unidade_base_id: (lookups.unidadesBase.data ?? []).filter((u: any) => u.is_active),
      area_atuacao_id: lookups.areasAtuacao.data ?? [],
      segmento_id: lookups.segmentos.data ?? [],
      fornecedor_id: lookups.fornecedores.data ?? [],
      funcionario_id: lookups.funcionarios.data ?? [],
      origem_venda_id: lookups.origensVenda.data ?? [],
      motivo_cancelamento_id: (lookups.motivosCancelamento.data ?? [])
        .map((m: any) => ({ id: m.id, nome: m.descricao })),
    };
    return (mapa[campo.campo] ?? []).map((o: any) => ({ id: String(o.id), nome: o.nome }));
  }, [campo, lookups]);

  const ehData = campo?.campo === "data_venda" || campo?.campo === "data_ativacao";
  const podeGravar = !!campo?.em_lote && sel.size > 0 && !!valor && !gravando;

  /**
   * Cidade e estado não se preenchem com um valor igual para todos — mas se
   * resolvem sozinhos pelo CEP de cada cliente. A tela consulta o CEP e o banco
   * resolve nome -> id, na mesma régua da importação do Hiper.
   */
  const ehGeo = campo?.campo === "cidade_id" || campo?.campo === "estado_id";

  /**
   * A data do próximo reajuste sai da data de ativação de cada produto — não é
   * um valor igual para todos. Usa a mesma calc_proximo_reajuste que a criação
   * de produto usa, para a tela não prometer uma data e o cadastro gravar outra.
   */
  const ehReajuste = campo?.campo === "data_proximo_reajuste";

  /**
   * Sem seleção, age sobre TODOS os pendentes do filtro atual.
   *
   * O valor não é escolhido por ninguém — sai da data de ativação de cada
   * produto. Exigir que alguém marque 710 caixas para aplicar uma regra
   * determinística é transformar em trabalho manual o que o sistema faz
   * sozinho, e é aí que o erro humano entra.
   */
  const calcularReajuste = async () => {
    if (!campo) return;
    setGravando(true);
    try {
      const { data, error } = await (supabase.rpc as any)("fn_cadastro_calcular_reajuste", {
        p_tenant_id: tid,
        p_ids: sel.size > 0 ? Array.from(sel) : null,
        p_unidades: unidade ? [Number(unidade)] : null,
        p_produto_id: produto ? Number(produto) : null,
      });
      if (error) throw error;
      const r = data as any;
      if (!r?.ok) throw new Error(r?.erro || "Não foi possível calcular.");
      toast({
        title: r.gravados === 0
          ? "Nada foi preenchido"
          : `${num(r.gravados)} ${r.gravados === 1 ? "data calculada" : "datas calculadas"}`,
        description: r.sem_ativacao > 0
          ? `${num(r.sem_ativacao)} ficaram de fora por não ter data de ativação — sem ela não há de onde derivar.`
          : undefined,
        variant: r.gravados === 0 ? "destructive" : undefined,
      });
      setSel(new Set());
      ["cadastro_incompleto_resumo", "cadastro_incompleto_lista", "clientes"]
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e: any) {
      toast({ title: "Não foi possível calcular", description: e.message, variant: "destructive" });
    } finally { setGravando(false); }
  };
  const comCep = useMemo(
    () => linhas.filter((l) => /^\d{8}$/.test(l.detalhe)),
    [linhas],
  );
  const selComCep = useMemo(
    () => comCep.filter((l) => sel.has(l.registro_id)),
    [comCep, sel],
  );

  const preencherPeloCep = async () => {
    if (!campo || selComCep.length === 0) return;
    setGravando(true);
    try {
      // De 5 em 5: o ViaCEP é serviço público e gratuito, e despejar 150
      // requisições de uma vez é a melhor forma de ser bloqueado.
      const itens: { cliente_id: string; cidade: string; uf: string }[] = [];
      let semResposta = 0;
      for (let i = 0; i < selComCep.length; i += 5) {
        const fatia = selComCep.slice(i, i + 5);
        const res = await Promise.all(fatia.map(async (l) => {
          try {
            const r = await fetch(`https://viacep.com.br/ws/${l.detalhe}/json/`);
            const j = await r.json();
            if (!j?.localidade || !j?.uf) return null;
            return { cliente_id: l.cliente_id, cidade: String(j.localidade), uf: String(j.uf) };
          } catch { return null; }
        }));
        for (const r of res) { if (r) itens.push(r); else semResposta++; }
      }

      if (itens.length === 0) {
        toast({
          title: "Nenhum CEP foi reconhecido",
          description: "Os CEPs selecionados não retornaram cidade. Confira na ficha de cada um.",
          variant: "destructive",
        });
        return;
      }

      const { data, error } = await (supabase.rpc as any)("fn_cadastro_preencher_cidade", {
        p_tenant_id: tid,
        p_itens: itens,
      });
      if (error) throw error;
      const r = data as any;
      if (!r?.ok) throw new Error(r?.erro || "Não foi possível preencher.");

      const recusados = (r.recusados ?? []) as { motivo: string }[];
      const partes: string[] = [];
      if (semResposta > 0) partes.push(`${num(semResposta)} com CEP que o ViaCEP não conhece`);
      if (recusados.length > 0) partes.push(`${num(recusados.length)} com cidade que não casa com o cadastro`);
      toast({
        title: r.gravados === 0
          ? "Nada foi preenchido"
          : `${num(r.gravados)} ${r.gravados === 1 ? "cidade preenchida" : "cidades preenchidas"} pelo CEP`,
        description: partes.length ? `Ficaram de fora: ${partes.join(" · ")}.` : undefined,
        variant: r.gravados === 0 ? "destructive" : undefined,
      });
      setSel(new Set());
      ["cadastro_incompleto_resumo", "cadastro_incompleto_lista", "clientes"]
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e: any) {
      toast({ title: "Não foi possível preencher pelo CEP", description: e.message, variant: "destructive" });
    } finally { setGravando(false); }
  };

  const aplicar = async () => {
    if (!campo) return;
    setGravando(true);
    try {
      const { data, error } = await (supabase.rpc as any)("fn_cadastro_preencher_lote", {
        p_tenant_id: tid,
        p_campo: campo.campo,
        p_ids: Array.from(sel),
        p_valor: valor,
      });
      if (error) throw error;
      const r = data as any;
      if (!r?.ok) throw new Error(r?.erro || "Não foi possível preencher.");
      toast({
        title: r.gravados === 0
          ? "Nada foi preenchido"
          : `${num(r.gravados)} ${r.gravados === 1 ? "registro preenchido" : "registros preenchidos"}`,
        // Quem já estava preenchido não é erro: é outra pessoa que chegou antes.
        description: r.ja_preenchidos > 0
          ? `${num(r.ja_preenchidos)} já tinham valor e ficaram como estavam.`
          : undefined,
        variant: r.gravados === 0 ? "destructive" : undefined,
      });
      setSel(new Set());
      ["cadastro_incompleto_resumo", "cadastro_incompleto_lista", "clientes"]
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e: any) {
      toast({ title: "Não foi possível preencher", description: e.message, variant: "destructive" });
    } finally { setGravando(false); }
  };

  const selectCls = "h-9 w-full rounded-md border bg-background px-3 text-sm";

  if (carregando) {
    return <div className="space-y-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-40 w-full" /></div>;
  }

  // ── painel: um cartão por campo ───────────────────────────────────────────
  if (!campo) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-4 text-sm">
          <p>
            Cada linha é um <strong>campo</strong> que alimenta indicador do painel e está vazio em
            parte da carteira. Comece pelo campo, filtre até sobrar o grupo que tem a{" "}
            <strong>mesma resposta</strong>, e preencha o grupo de uma vez. A lista mostra o
            sistema e a unidade de cada cliente, e já vem agrupada por eles.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Isto é saneamento de base: encolhe devagar e não chega a zero, porque cadastro antigo
            raramente tem quem soube da venda. Serve para atacar em lote onde você sabe a resposta.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {campos.map((c) => (
            <button key={c.campo} type="button"
              onClick={() => { setCampo(c); limparFiltros(); }}
              className="rounded-lg border p-3 text-left transition-colors hover:bg-muted/40 hover:border-primary/40">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-sm">{c.rotulo}</span>
                <span className="text-lg font-semibold tabular-nums">{num(c.faltando)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{c.indicador}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <Badge variant="secondary" className="text-[10px]">
                  {c.escopo === "produto" ? "no produto do cliente"
                    : c.escopo === "cancelado" ? "em quem cancelou" : "no cliente"}
                </Badge>
                {!c.em_lote && (
                  <Badge variant="outline" className="text-[10px]">valor próprio de cada um</Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── um campo escolhido ────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => { setCampo(null); limparFiltros(); }}>
          <ArrowLeft className="h-4 w-4" /> Todos os campos
        </Button>
        <span className="font-medium">{campo.rotulo}</span>
        <Badge variant="secondary">{num(total)} sem preencher</Badge>
        <span className="text-xs text-muted-foreground">{campo.indicador}</span>
      </div>

      {ehReajuste && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
          <div className="min-w-0 flex-1 text-sm">
            <p>
              A data do próximo reajuste sai da <strong>data de ativação</strong> de cada produto:
              mesmo dia e mês, no próximo aniversário que ainda não passou.
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Ativação em 14/09/2022 vira 14/09/2026 se a data ainda não chegou este ano, e
              14/09/2027 se já passou. Produto sem data de ativação fica de fora, e quem já tem
              data não é tocado. <strong>Sem marcar nada, vale para todos os do filtro</strong> —
              não só os {num(linhas.length)} desta página.
            </p>
          </div>
          <Button disabled={gravando} onClick={calcularReajuste}>
            {gravando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
            {sel.size > 0
              ? `Calcular os ${num(sel.size)} selecionados`
              : `Calcular todos os ${num(total)}`}
          </Button>
        </div>
      )}

      {!campo.em_lote && !ehGeo && !ehReajuste && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <strong>{campo.rotulo}</strong> tem valor próprio em cada cliente, então não há o que
          preencher em lote — um valor igual para todos estragaria o cadastro. Abra a ficha de cada
          um pela lista abaixo.
        </div>
      )}

      {ehGeo && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
          <div className="min-w-0 flex-1 text-sm">
            <p>
              <strong>{campo.rotulo}</strong> não tem um valor igual para todos, mas sai do{" "}
              <strong>CEP</strong> de cada cliente. {num(comCep.length)} de {num(linhas.length)} na
              lista têm CEP.
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              O estado só é gravado em quem está sem ele: o CEP confirma, não corrige.
            </p>
          </div>
          <Button disabled={selComCep.length === 0 || gravando} onClick={preencherPeloCep}>
            {gravando ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
            Preencher {selComCep.length > 0 ? num(selComCep.length) : ""} pelo CEP
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
        <div className="space-y-1">
          <Label className="text-xs">Buscar</Label>
          <Input className="h-9 w-56" placeholder="Código, nome ou CNPJ…"
            value={busca} onChange={(e) => { setBusca(e.target.value); setSel(new Set()); }} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Unidade</Label>
          <select className={selectCls + " w-44"} value={unidade}
            onChange={(e) => { setUnidade(e.target.value); setSel(new Set()); }}>
            <option value="">Todas</option>
            {(lookups.unidadesBase.data ?? []).filter((u: any) => u.is_active)
              .map((u: any) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Produto</Label>
          <select className={selectCls + " w-52"} value={produto}
            onChange={(e) => { setProduto(e.target.value); setSel(new Set()); }}>
            <option value="">Todos</option>
            {(lookups.produtos.data ?? []).map((p: any) => (
              <option key={p.id} value={p.id}>{p.nome}</option>
            ))}
          </select>
        </div>
        {(busca || unidade || produto) && (
          <Button variant="ghost" size="sm" onClick={limparFiltros}>Limpar</Button>
        )}
      </div>

      {campo.em_lote && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
          <div className="space-y-1">
            <Label className="text-xs">Preencher {campo.rotulo.toLowerCase()} com</Label>
            {ehData ? (
              <Input type="date" className="h-9 w-44" value={valor}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setValor(e.target.value)} />
            ) : (
              <select className={selectCls + " w-64"} value={valor} onChange={(e) => setValor(e.target.value)}>
                <option value="">Escolha…</option>
                {opcoes.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
              </select>
            )}
          </div>
          <Button disabled={!podeGravar} onClick={aplicar}>
            {gravando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            Preencher {sel.size > 0 ? num(sel.size) : ""} selecionados
          </Button>
          <span className="text-xs text-muted-foreground">
            {sel.size === 0 ? "Marque os registros abaixo." : !valor ? "Escolha o valor." : "Só quem está vazio recebe."}
          </span>
        </div>
      )}

      {listando ? (
        <Skeleton className="h-64 w-full" />
      ) : linhas.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nada sem preencher com esses filtros.
        </p>
      ) : (
        <div className="rounded-lg border divide-y">
          {(campo.em_lote || ehGeo || ehReajuste) && (
            <label className="flex items-center gap-2 bg-muted/30 px-3 py-2 text-sm">
              <input type="checkbox"
                checked={(ehGeo ? comCep : linhas).length > 0
                  && (ehGeo ? comCep : linhas).every((l) => sel.has(l.registro_id))}
                onChange={(e) => setSel(e.target.checked
                  ? new Set((ehGeo ? comCep : linhas).map((l) => l.registro_id)) : new Set())} />
              Selecionar {ehGeo ? `os ${num(comCep.length)} com CEP` : `os ${num(linhas.length)} desta lista`}
              {total > linhas.length && (
                <span className="text-xs text-muted-foreground">
                  (de {num(total)} — refine os filtros para alcançar o resto)
                </span>
              )}
            </label>
          )}
          {linhas.map((l) => (
            <div key={l.registro_id} className="flex items-center gap-3 px-3 py-2 text-sm">
              {(campo.em_lote || ehReajuste || (ehGeo && /^\d{8}$/.test(l.detalhe))) ? (
                <input type="checkbox" className="shrink-0" checked={sel.has(l.registro_id)}
                  onChange={() => setSel((s) => {
                    const n = new Set(s);
                    n.has(l.registro_id) ? n.delete(l.registro_id) : n.add(l.registro_id);
                    return n;
                  })} />
              ) : ehGeo ? (
                // Sem CEP não há como resolver, mas o espaço fica: sem isto a
                // linha desalinha das outras e a lista parece quebrada.
                <span className="w-[13px] shrink-0" aria-hidden />
              ) : null}
              {l.codigo != null && (
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {l.codigo}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">{l.cliente_nome}</span>
              <span className="hidden sm:block text-xs text-muted-foreground truncate max-w-[16rem]">
                {ehGeo && /^\d{8}$/.test(l.detalhe)
                  ? `CEP ${l.detalhe.slice(0, 5)}-${l.detalhe.slice(5)}`
                  : l.detalhe}
              </span>
              {/* A unidade fecha a decisão: o produto diz o sistema, a unidade
                  diz quem atende. A lista já vem agrupada por ela. */}
              <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
                {l.unidade}
              </Badge>
              {(() => {
                const d = dataBR(l.data_cadastro);
                return (
                  <span
                    title={d.suspeita ? "Data de cadastro impossível — provável erro de importação" : "Data de cadastro"}
                    className={`shrink-0 text-xs tabular-nums ${
                      d.suspeita ? "text-amber-500 font-medium" : "text-muted-foreground"}`}>
                    {d.texto}
                  </span>
                );
              })()}
              <a href={`/clientes/${l.cliente_id}`} target="_blank" rel="noreferrer"
                className="shrink-0 text-muted-foreground hover:text-foreground" title="Abrir a ficha">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
