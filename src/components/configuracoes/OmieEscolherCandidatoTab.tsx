import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  AlertCircle, CheckCircle2, Link2, Loader2, RefreshCw, Sparkles,
} from "lucide-react";

type Pista = "limpo" | "decisao" | "parear" | "conflito" | "bloqueado";

type ContratoDS = {
  ds_contract_id: string;
  ds_customer_id: string;
  razao_ds: string | null;
  nome_fantasia_ds: string | null;
  valor_mrr_ds: number | null;
  vigencia_inicial_ds: string | null;
  dia_venc_ds: number | null;
  modelo_ds: string | null;
  status_usuario: string | null;
  candidato_escolhido: number | string | null;
  sugestao_codigo_contrato_omie?: number | null;
};

type Candidato = {
  codigo_cliente_omie: number;
  codigo_contrato_omie: number;
  razao_social_omie: string | null;
  valor_omie: number | null;
  delta_valor: number | null;
  valor_bate: boolean;
  vigencia_inicial_omie: string | null;
  vigencia_final_omie: string | null;
  dia_venc_omie: number | null;
  situacao_contrato: string | null;
  saudavel: boolean;
  omie_inativo: boolean;
  tem_cancelado_omie: boolean;
  codigo_cliente_integracao: string | null;
  ja_vinculado_hint: boolean;
  rank: number;
  qtd_contratos_ativos_omie?: number | null;
};

type ClienteSemContrato = {
  codigo_cliente_omie: number;
  razao_social_omie: string | null;
  omie_inativo: boolean;
  codigo_cliente_integracao: string | null;
};

type Grupo = {
  cnpj_norm: string;
  pista: Pista;
  n_ds: number;
  n_omie_contratos: number;
  recomendado_codigo_contrato_omie: number | null;
  contratos_ds: ContratoDS[];
  candidatos: Candidato[];
  clientes_omie_sem_contrato: ClienteSemContrato[];
};

type ListaResp = {
  ok: boolean;
  total_grupos: number;
  total_ds_rows: number;
  resumo_por_pista: Record<Pista, number>;
  grupos: Grupo[];
};

const PISTA_META: Record<Pista, { label: string; badge: string; order: number }> = {
  conflito:  { label: "Conflito",  badge: "bg-destructive text-destructive-foreground", order: 0 },
  bloqueado: { label: "Bloqueado", badge: "bg-muted text-muted-foreground border border-border", order: 1 },
  parear:    { label: "Parear",    badge: "bg-purple-600 text-white", order: 2 },
  decisao:   { label: "Decisão",   badge: "bg-blue-600 text-white", order: 3 },
  limpo:     { label: "Limpo",     badge: "bg-emerald-600 text-white", order: 4 },
};

function formatCNPJ(v?: string | null): string {
  if (!v) return "—";
  const d = String(v).replace(/\D/g, "");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return v;
}
function formatBRL(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function formatDate(v?: string | null): string {
  if (!v) return "—";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }
  try { return new Date(s).toLocaleDateString("pt-BR"); } catch { return s; }
}

type Confirmacao = { ds_contract_id: string; codigo_contrato_omie: number };

type ConflitoBackend = {
  omie_contract_id?: string | number;
  ds_contracts?: string[];
  ds_contract_existente?: string;
  ds_contract_novo?: string;
};

type Invalido = { ds_contract_id: string; codigo_contrato_omie: string | number; motivo: string };

type ErrorState =
  | { kind: "invalidos"; itens: Invalido[] }
  | { kind: "colisao_lote"; conflitos: ConflitoBackend[] }
  | { kind: "colisao_existente"; conflitos: ConflitoBackend[] }
  | null;

export default function OmieEscolherCandidatoTab() {
  const qc = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  const [filtro, setFiltro] = useState<Pista | "todos">("todos");
  const [confirmarTodosLimpos, setConfirmarTodosLimpos] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // key do grupo/ação em processamento
  const [erros, setErros] = useState<Record<string, ErrorState>>({}); // por cnpj_norm

  // Escolhas locais para pistas "decisao"/"parear"/"conflito"
  // Map: `${cnpj_norm}::${ds_contract_id}` -> codigo_contrato_omie
  const [escolhas, setEscolhas] = useState<Record<string, number>>({});

  const { data, isLoading, isFetching, refetch } = useQuery<ListaResp>({
    queryKey: ["recon-escolher-candidato", "listar", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("recon-candidatos-listar", {
        body: { tenant_id: tid },
      });
      if (error) throw error;
      return data as ListaResp;
    },
  });

  const grupos = data?.grupos ?? [];
  const resumo = data?.resumo_por_pista ?? { limpo: 0, decisao: 0, parear: 0, conflito: 0, bloqueado: 0 };
  const gruposFiltrados = useMemo(() => {
    if (filtro === "todos") return grupos;
    return grupos.filter((g) => g.pista === filtro);
  }, [grupos, filtro]);

  // Pré-seleciona sugestões vindas do backend (sem forçar: só quando não há escolha manual).
  useEffect(() => {
    if (!grupos.length) return;
    setEscolhas((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const g of grupos) {
        for (const ds of g.contratos_ds) {
          const sug = ds.sugestao_codigo_contrato_omie;
          if (sug == null) continue;
          const k = `${g.cnpj_norm}::${ds.ds_contract_id}`;
          if (next[k] != null) continue;
          // só usa a sugestão se o candidato ainda existe e não está indisponível
          const cand = g.candidatos.find((c) => Number(c.codigo_contrato_omie) === Number(sug));
          if (!cand || cand.ja_vinculado_hint) continue;
          next[k] = Number(sug);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [grupos]);

  function keyOf(cnpj: string, ds_contract_id: string) { return `${cnpj}::${ds_contract_id}`; }

  function setEscolha(cnpj: string, ds_contract_id: string, codigo: number | null) {
    setEscolhas((prev) => {
      const next = { ...prev };
      const k = keyOf(cnpj, ds_contract_id);
      if (codigo == null) delete next[k];
      else next[k] = codigo;
      return next;
    });
  }

  function removeResolvidos(ds_ids: string[]) {
    if (!data) return;
    const set = new Set(ds_ids);
    const novosGrupos: Grupo[] = [];
    let removedDs = 0;
    for (const g of data.grupos) {
      const restantes = g.contratos_ds.filter((c) => !set.has(c.ds_contract_id));
      removedDs += g.contratos_ds.length - restantes.length;
      if (restantes.length === 0) continue;
      novosGrupos.push({ ...g, contratos_ds: restantes, n_ds: restantes.length });
    }
    const novoResumo = { ...resumo };
    // recompute totalizadores por pista simplificado (subtrair grupos que sumiram)
    const contagem: Record<Pista, number> = { limpo: 0, decisao: 0, parear: 0, conflito: 0, bloqueado: 0 };
    for (const g of novosGrupos) contagem[g.pista]++;
    qc.setQueryData<ListaResp>(["recon-escolher-candidato", "listar", tid], {
      ...data,
      grupos: novosGrupos,
      total_grupos: novosGrupos.length,
      total_ds_rows: Math.max(0, (data.total_ds_rows ?? 0) - removedDs),
      resumo_por_pista: contagem,
    });
    // limpa escolhas dos ds resolvidos
    setEscolhas((prev) => {
      const next: Record<string, number> = {};
      for (const [k, v] of Object.entries(prev)) {
        const dsId = k.split("::")[1];
        if (!set.has(dsId)) next[k] = v;
      }
      return next;
    });
  }

  async function confirmar(cnpj: string, confirmacoes: Confirmacao[], key: string) {
    if (!confirmacoes.length) return;
    setBusy(key);
    setErros((p) => ({ ...p, [cnpj]: null }));
    try {
      const { data, error } = await supabase.functions.invoke("recon-candidato-confirmar", {
        body: { tenant_id: tid, confirmacoes },
      });
      if (error) throw error;
      const res = data as any;
      if (res?.ok) {
        const resolvidos: { ds_contract_id: string }[] = res.resolvidos ?? [];
        removeResolvidos(resolvidos.map((r) => r.ds_contract_id));
        await qc.invalidateQueries({ queryKey: ["recon-escolher-candidato", "listar", tid] });
        toast.success(`${res.vinculados ?? resolvidos.length} vínculo(s) criados`);
      } else {
        // interpretar erros 409
        const detalhe = res?.detalhe ?? res;
        if (res?.invalidos) {
          setErros((p) => ({ ...p, [cnpj]: { kind: "invalidos", itens: res.invalidos } }));
        } else if (detalhe?.error === "colisao_no_lote") {
          setErros((p) => ({ ...p, [cnpj]: { kind: "colisao_lote", conflitos: detalhe.conflitos ?? [] } }));
        } else if (detalhe?.error === "colisao_com_existente") {
          setErros((p) => ({ ...p, [cnpj]: { kind: "colisao_existente", conflitos: detalhe.conflitos ?? [] } }));
        }
        toast.error(res?.error || "Falha ao confirmar");
      }
    } catch (e: any) {
      toast.error(e?.message || "Falha ao confirmar");
    } finally {
      setBusy(null);
    }
  }

  async function vincularTodosLimpos() {
    const confs: Confirmacao[] = [];
    for (const g of grupos) {
      if (g.pista !== "limpo") continue;
      if (!g.recomendado_codigo_contrato_omie) continue;
      const ds = g.contratos_ds[0];
      if (!ds) continue;
      confs.push({
        ds_contract_id: ds.ds_contract_id,
        codigo_contrato_omie: Number(g.recomendado_codigo_contrato_omie),
      });
    }
    if (!confs.length) { toast.info("Nenhum grupo limpo para vincular"); return; }
    setBusy("__todos_limpos__");
    try {
      const { data, error } = await supabase.functions.invoke("recon-candidato-confirmar", {
        body: { tenant_id: tid, confirmacoes: confs },
      });
      if (error) throw error;
      const res = data as any;
      if (res?.ok) {
        const resolvidos: { ds_contract_id: string }[] = res.resolvidos ?? [];
        removeResolvidos(resolvidos.map((r) => r.ds_contract_id));
        await qc.invalidateQueries({ queryKey: ["recon-escolher-candidato", "listar", tid] });
        toast.success(`${res.vinculados ?? resolvidos.length} contratos vinculados`);
      } else {
        toast.error(res?.error || "Falha ao vincular em lote");
        // Marcar erro geral no primeiro grupo afetado
      }
    } catch (e: any) {
      toast.error(e?.message || "Falha ao vincular em lote");
    } finally {
      setBusy(null);
      setConfirmarTodosLimpos(false);
    }
  }

  const totalLimpos = resumo.limpo ?? 0;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Barra de resumo */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 py-3">
          <PistaChip label="Todos" active={filtro === "todos"} onClick={() => setFiltro("todos")}
            count={data?.total_grupos ?? 0} />
          {(Object.keys(PISTA_META) as Pista[])
            .sort((a, b) => PISTA_META[a].order - PISTA_META[b].order)
            .map((p) => (
              <PistaChip
                key={p}
                label={PISTA_META[p].label}
                active={filtro === p}
                onClick={() => setFiltro(p)}
                count={resumo[p] ?? 0}
                variantClass={PISTA_META[p].badge}
              />
            ))}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {data?.total_ds_rows ?? 0} pendência(s)
            </span>
            <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <Button
              size="sm"
              onClick={() => setConfirmarTodosLimpos(true)}
              disabled={!totalLimpos || busy === "__todos_limpos__"}
              className="gap-1"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Vincular todos os limpos ({totalLimpos})
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Lista de grupos */}
      {gruposFiltrados.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            {grupos.length === 0
              ? "Nenhuma pendência de conferência 🎉"
              : "Nenhum grupo para o filtro selecionado."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {gruposFiltrados.map((g) => (
            <GrupoCard
              key={g.cnpj_norm}
              grupo={g}
              escolhas={escolhas}
              setEscolha={setEscolha}
              erro={erros[g.cnpj_norm] ?? null}
              busy={busy}
              onConfirmarLimpo={() => {
                if (!g.recomendado_codigo_contrato_omie) return;
                const ds = g.contratos_ds[0];
                if (!ds) return;
                confirmar(g.cnpj_norm, [{
                  ds_contract_id: ds.ds_contract_id,
                  codigo_contrato_omie: Number(g.recomendado_codigo_contrato_omie),
                }], g.cnpj_norm);
              }}
              onConfirmarDecisao={() => {
                const ds = g.contratos_ds[0];
                if (!ds) return;
                const escolhido = escolhas[keyOf(g.cnpj_norm, ds.ds_contract_id)];
                if (!escolhido) return;
                confirmar(g.cnpj_norm, [{
                  ds_contract_id: ds.ds_contract_id,
                  codigo_contrato_omie: Number(escolhido),
                }], g.cnpj_norm);
              }}
              onConfirmarPareamento={() => {
                const confs: Confirmacao[] = [];
                for (const ds of g.contratos_ds) {
                  const escolhido = escolhas[keyOf(g.cnpj_norm, ds.ds_contract_id)];
                  if (escolhido) confs.push({
                    ds_contract_id: ds.ds_contract_id,
                    codigo_contrato_omie: Number(escolhido),
                  });
                }
                if (!confs.length) return;
                confirmar(g.cnpj_norm, confs, g.cnpj_norm);
              }}
            />
          ))}
        </div>
      )}

      <AlertDialog open={confirmarTodosLimpos} onOpenChange={setConfirmarTodosLimpos}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Vincular {totalLimpos} contratos limpos?</AlertDialogTitle>
            <AlertDialogDescription>
              Cada grupo "limpo" tem 1 contrato DS e 1 candidato Omie recomendado. Os vínculos
              serão criados em uma única operação.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={vincularTodosLimpos} disabled={busy === "__todos_limpos__"}>
              {busy === "__todos_limpos__" ? "Vinculando..." : "Vincular todos"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PistaChip({
  label, active, onClick, count, variantClass,
}: { label: string; active: boolean; onClick: () => void; count: number; variantClass?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition
        ${active ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background hover:bg-accent"}`}
    >
      <span>{label}</span>
      <span className={`inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold
        ${variantClass ?? "bg-muted text-muted-foreground"}`}>
        {count}
      </span>
    </button>
  );
}

function PistaBadge({ pista }: { pista: Pista }) {
  const meta = PISTA_META[pista];
  return <Badge className={meta.badge}>{meta.label}</Badge>;
}

function HealthBadge({ c }: { c: Candidato }) {
  if (c.saudavel) return <Badge className="bg-emerald-600 text-white">Ativo</Badge>;
  return (
    <Badge className="bg-amber-500 text-white gap-1">
      <AlertCircle className="h-3 w-3" /> Atenção
    </Badge>
  );
}

function DeltaLabel({ c }: { c: Candidato }) {
  if (c.delta_valor == null) return null;
  const positivo = c.delta_valor >= 0;
  const cls = c.valor_bate ? "text-emerald-600" : "text-amber-600";
  const sinal = positivo ? "+" : "";
  return (
    <span className={`text-xs font-medium ${cls}`}>
      Δ {sinal}{formatBRL(c.delta_valor)}
    </span>
  );
}

function ContratoDSInfo({ ds }: { ds: ContratoDS }) {
  return (
    <div className="space-y-1 text-sm">
      <div className="font-medium truncate">{ds.nome_fantasia_ds || ds.razao_ds || "—"}</div>
      {ds.razao_ds && ds.nome_fantasia_ds && (
        <div className="text-xs text-muted-foreground truncate">{ds.razao_ds}</div>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>MRR: <span className="font-medium text-foreground">{formatBRL(ds.valor_mrr_ds)}</span></span>
        {ds.vigencia_inicial_ds && <span>Início: {formatDate(ds.vigencia_inicial_ds)}</span>}
        {ds.dia_venc_ds != null && <span>Venc: dia {ds.dia_venc_ds}</span>}
        {ds.modelo_ds && <span>Modelo: {ds.modelo_ds}</span>}
      </div>
    </div>
  );
}

function CandidatoInfo({ c, recomendado, sugerido }: { c: Candidato; recomendado?: boolean; sugerido?: boolean }) {
  return (
    <div className="space-y-1 text-sm min-w-0 flex-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium truncate">{c.razao_social_omie || "—"}</span>
        {recomendado && <Badge className="bg-blue-600 text-white text-[10px]">Recomendado</Badge>}
        {sugerido && (
          <Badge className="bg-emerald-600 text-white text-[10px] gap-1">
            <CheckCircle2 className="h-3 w-3" /> Valor confere
          </Badge>
        )}
        <HealthBadge c={c} />
        {c.situacao_contrato && (
          <Badge variant="outline" className="text-[10px]">Situação {c.situacao_contrato}</Badge>
        )}
        {c.omie_inativo && <Badge variant="destructive" className="text-[10px]">Cliente inativo</Badge>}
        {c.tem_cancelado_omie && <Badge variant="destructive" className="text-[10px]">Tem cancelado</Badge>}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Contrato: <span className="font-mono text-foreground">{c.codigo_contrato_omie}</span></span>
        <span>Valor Omie: <span className="font-medium text-foreground">{formatBRL(c.valor_omie)}</span></span>
        <DeltaLabel c={c} />
        {c.vigencia_inicial_omie && <span>Início: {formatDate(c.vigencia_inicial_omie)}</span>}
        {c.vigencia_final_omie && <span>Fim: {formatDate(c.vigencia_final_omie)}</span>}
        {c.dia_venc_omie != null && <span>Venc: dia {c.dia_venc_omie}</span>}
      </div>
    </div>
  );
}

function ErroBox({ erro }: { erro: ErrorState }) {
  if (!erro) return null;
  if (erro.kind === "invalidos") {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <div className="font-medium mb-1">Escolha inválida</div>
          <ul className="list-disc pl-4 text-xs space-y-0.5">
            {erro.itens.map((i, idx) => (
              <li key={idx}>Contrato DS <span className="font-mono">{i.ds_contract_id.slice(0, 8)}</span> → Omie {i.codigo_contrato_omie}: {i.motivo}</li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>
    );
  }
  if (erro.kind === "colisao_lote") {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <div className="font-medium mb-1">Colisão no lote</div>
          <div className="text-xs">Dois contratos DS tentaram vincular ao mesmo contrato Omie:</div>
          <ul className="list-disc pl-4 text-xs space-y-0.5 mt-1">
            {erro.conflitos.map((c, idx) => (
              <li key={idx}>
                Omie <span className="font-mono">{c.omie_contract_id}</span>: {(c.ds_contracts ?? []).map((s) => s.slice(0, 8)).join(", ")}
              </li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>
        <div className="font-medium mb-1">Contrato Omie já vinculado</div>
        <ul className="list-disc pl-4 text-xs space-y-0.5">
          {erro.conflitos.map((c, idx) => (
            <li key={idx}>
              Omie <span className="font-mono">{c.omie_contract_id}</span> já pertence a{" "}
              <span className="font-mono">{c.ds_contract_existente?.slice(0, 8)}</span>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function GrupoCard({
  grupo, escolhas, setEscolha, erro, busy,
  onConfirmarLimpo, onConfirmarDecisao, onConfirmarPareamento,
}: {
  grupo: Grupo;
  escolhas: Record<string, number>;
  setEscolha: (cnpj: string, ds_contract_id: string, codigo: number | null) => void;
  erro: ErrorState;
  busy: string | null;
  onConfirmarLimpo: () => void;
  onConfirmarDecisao: () => void;
  onConfirmarPareamento: () => void;
}) {
  const isBusy = busy === grupo.cnpj_norm;
  const cabecalho = grupo.contratos_ds[0];
  const nome = cabecalho?.nome_fantasia_ds || cabecalho?.razao_ds || "—";

  // conflito existente: desabilitar aquele candidato
  const desabilitadosPorErro = useMemo(() => {
    const set = new Set<string>();
    if (erro?.kind === "colisao_existente") {
      for (const c of erro.conflitos) set.add(String(c.omie_contract_id));
    }
    return set;
  }, [erro]);

  const maxAtivosOmie = useMemo(() => {
    let max = 0;
    for (const c of grupo.candidatos) {
      const n = Number(c.qtd_contratos_ativos_omie ?? 0);
      if (n > max) max = n;
    }
    return max;
  }, [grupo.candidatos]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              <PistaBadge pista={grupo.pista} />
              <span className="truncate">{nome}</span>
            </CardTitle>
            <div className="text-xs text-muted-foreground mt-1">
              CNPJ: <span className="font-mono">{formatCNPJ(grupo.cnpj_norm)}</span>
              {" · "}{grupo.n_ds} DS / {grupo.n_omie_contratos} candidato(s)
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErroBox erro={erro} />

        {maxAtivosOmie > 1 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Este cliente tem {maxAtivosOmie} contratos ativos no Omie.
            </AlertDescription>
          </Alert>
        )}

        {grupo.pista === "limpo" && renderLimpo()}
        {grupo.pista === "decisao" && renderDecisao()}
        {(grupo.pista === "parear" || grupo.pista === "conflito") && renderPareamento()}
        {grupo.pista === "bloqueado" && renderBloqueado()}
      </CardContent>
    </Card>
  );

  function renderLimpo() {
    const ds = grupo.contratos_ds[0];
    const cand = grupo.candidatos.find(
      (c) => Number(c.codigo_contrato_omie) === Number(grupo.recomendado_codigo_contrato_omie)
    ) ?? grupo.candidatos[0];
    if (!ds || !cand) return <p className="text-sm text-muted-foreground">Sem dados.</p>;
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded border p-3">
          <div className="text-[10px] uppercase text-muted-foreground mb-1">DoctorSaaS</div>
          <ContratoDSInfo ds={ds} />
        </div>
        <div className="rounded border p-3 flex flex-col gap-2">
          <div className="text-[10px] uppercase text-muted-foreground">Omie</div>
          <CandidatoInfo c={cand} recomendado sugerido={ds.sugestao_codigo_contrato_omie != null && Number(ds.sugestao_codigo_contrato_omie) === Number(cand.codigo_contrato_omie)} />
          <div className="mt-auto flex justify-end pt-2">
            <Button size="sm" onClick={onConfirmarLimpo} disabled={isBusy} className="gap-1">
              {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
              Vincular
            </Button>
          </div>
        </div>
      </div>
    );
  }

  function renderDecisao() {
    const ds = grupo.contratos_ds[0];
    if (!ds) return null;
    const k = `${grupo.cnpj_norm}::${ds.ds_contract_id}`;
    const escolhido = escolhas[k];
    return (
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="rounded border p-3">
          <div className="text-[10px] uppercase text-muted-foreground mb-1">DoctorSaaS</div>
          <ContratoDSInfo ds={ds} />
        </div>
        <div className="rounded border p-3 space-y-2">
          <div className="text-[10px] uppercase text-muted-foreground">Escolha o contrato Omie</div>
          <RadioGroup
            value={escolhido ? String(escolhido) : ""}
            onValueChange={(v) => setEscolha(grupo.cnpj_norm, ds.ds_contract_id, Number(v))}
            className="space-y-2"
          >
            {grupo.candidatos.map((c) => {
              const disabled = c.ja_vinculado_hint || desabilitadosPorErro.has(String(c.codigo_contrato_omie));
              const recomendado = Number(c.codigo_contrato_omie) === Number(grupo.recomendado_codigo_contrato_omie);
              const id = `cand-${grupo.cnpj_norm}-${c.codigo_contrato_omie}`;
              return (
                <Label
                  key={c.codigo_contrato_omie}
                  htmlFor={id}
                  className={`flex items-start gap-2 rounded border p-2 cursor-pointer ${disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-accent"}`}
                >
                  <RadioGroupItem id={id} value={String(c.codigo_contrato_omie)} disabled={disabled} className="mt-1" />
                  <CandidatoInfo c={c} recomendado={recomendado} sugerido={ds.sugestao_codigo_contrato_omie != null && Number(ds.sugestao_codigo_contrato_omie) === Number(c.codigo_contrato_omie)} />
                  {c.ja_vinculado_hint && <Badge variant="outline" className="text-[10px] shrink-0">já vinculado</Badge>}
                </Label>
              );
            })}
          </RadioGroup>
          <div className="flex justify-end pt-2">
            <Button size="sm" onClick={onConfirmarDecisao} disabled={!escolhido || isBusy} className="gap-1">
              {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
              Vincular
            </Button>
          </div>
        </div>
      </div>
    );
  }

  function renderPareamento() {
    // candidatos usados = escolhas já feitas nesse grupo (por outras linhas)
    const usados = new Map<number, string>(); // codigo_contrato_omie -> ds_contract_id
    for (const ds of grupo.contratos_ds) {
      const v = escolhas[`${grupo.cnpj_norm}::${ds.ds_contract_id}`];
      if (v) usados.set(Number(v), ds.ds_contract_id);
    }
    const candidatosDisponiveisBase = grupo.candidatos.filter(
      (c) => !c.ja_vinculado_hint && !desabilitadosPorErro.has(String(c.codigo_contrato_omie))
    );
    const isConflito = grupo.pista === "conflito";
    const totalPareaveis = candidatosDisponiveisBase.length;

    return (
      <div className="space-y-2">
        {isConflito && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Mais contratos DS ({grupo.n_ds}) que candidatos Omie ({grupo.n_omie_contratos}). Alguns ficarão sem opção.
            </AlertDescription>
          </Alert>
        )}
        <div className="space-y-2">
          {grupo.contratos_ds.map((ds, idx) => {
            const k = `${grupo.cnpj_norm}::${ds.ds_contract_id}`;
            const escolhido = escolhas[k];
            // opções: candidatos não usados por outras linhas OU o próprio escolhido dessa linha
            const opcoes = grupo.candidatos.filter((c) => {
              const codigo = Number(c.codigo_contrato_omie);
              if (c.ja_vinculado_hint) return false;
              if (desabilitadosPorErro.has(String(codigo))) return false;
              const usadoPor = usados.get(codigo);
              if (usadoPor && usadoPor !== ds.ds_contract_id) return false;
              return true;
            });
            const bloqueadoPorFalta = isConflito && idx >= totalPareaveis && !escolhido;
            return (
              <div key={ds.ds_contract_id} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] rounded border p-3">
                <ContratoDSInfo ds={ds} />
                <div>
                  {bloqueadoPorFalta ? (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription className="text-xs">
                        Sem contrato Omie disponível — criar o contrato no Omie ou revisar duplicidade no DS.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <Select
                      value={escolhido ? String(escolhido) : ""}
                      onValueChange={(v) => setEscolha(grupo.cnpj_norm, ds.ds_contract_id, v ? Number(v) : null)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Escolher contrato Omie..." />
                      </SelectTrigger>
                      <SelectContent>
                        {opcoes.length === 0 && (
                          <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum disponível</div>
                        )}
                        {opcoes.map((c) => {
                          const recomendado = Number(c.codigo_contrato_omie) === Number(grupo.recomendado_codigo_contrato_omie);
                          return (
                            <SelectItem key={c.codigo_contrato_omie} value={String(c.codigo_contrato_omie)}>
                              <span className="flex items-center gap-2 text-xs">
                                <span className="font-mono">{c.codigo_contrato_omie}</span>
                                <span className="truncate max-w-[220px]">{c.razao_social_omie}</span>
                                <span className="text-muted-foreground">{formatBRL(c.valor_omie)}</span>
                                {recomendado && <Badge className="bg-blue-600 text-white text-[9px]">Rec.</Badge>}
                                {!c.saudavel && <Badge className="bg-amber-500 text-white text-[9px]">!</Badge>}
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-end pt-1">
          <Button
            size="sm"
            onClick={onConfirmarPareamento}
            disabled={isBusy || usados.size === 0}
            className="gap-1"
          >
            {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            Vincular pareados ({usados.size})
          </Button>
        </div>
      </div>
    );
  }

  function renderBloqueado() {
    return (
      <div className="space-y-2">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Nenhum contrato Omie candidato para este CNPJ. Resolver manualmente.
          </AlertDescription>
        </Alert>
        <div className="space-y-2">
          {grupo.contratos_ds.map((ds) => (
            <div key={ds.ds_contract_id} className="rounded border p-3">
              <ContratoDSInfo ds={ds} />
            </div>
          ))}
        </div>
        {grupo.clientes_omie_sem_contrato.length > 0 && (
          <div className="rounded border p-3 space-y-1">
            <div className="text-[10px] uppercase text-muted-foreground">Clientes Omie sem contrato</div>
            {grupo.clientes_omie_sem_contrato.map((c) => (
              <div key={c.codigo_cliente_omie} className="flex items-center gap-2 text-xs">
                <span className="font-mono">{c.codigo_cliente_omie}</span>
                <span className="truncate flex-1">{c.razao_social_omie || "—"}</span>
                {c.omie_inativo && <Badge variant="destructive" className="text-[10px]">Inativo</Badge>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
}
