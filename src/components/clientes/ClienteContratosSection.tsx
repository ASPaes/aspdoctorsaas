import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "@/hooks/use-toast";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ScrollText, Plus, Pencil, ChevronDown, ChevronRight,
  ExternalLink, Loader2, XCircle, RefreshCw, AlertTriangle,
} from "lucide-react";
import { NumericInput } from "@/components/ui/numeric-input";
import { useProfile } from "@/hooks/useProfile";

interface Props {
  clienteId: string;
}

interface Contrato {
  id: string;
  numero: string;
  tipo: "base" | "aditivo";
  contrato_pai_id: string | null;
  data_venda: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  data_proximo_reajuste: string | null;
  prazo_meses: number | null;
  fidelidade_meses: number | null;
  multa_rescisoria_pct: number | null;
  indice_reajuste: string | null;
  modelo_contrato_id: number | null;
  recorrencia: string | null;
  funcionario_id: number | null;
  origem_venda_id: number | null;
  forma_pagamento_ativacao_id: number | null;
  vlr_total_mensal: number | null;
  vlr_total_ativacao: number | null;
  observacoes: string | null;
  link_assinatura: string | null;
  assinado_em: string | null;
  status: string;
  cancelado_em: string | null;
  motivo_cancelamento: string | null;
  dia_vencimento: number | null;
  forma_pagamento_mensalidade_id: number | null;
  modelos_contrato?: { nome: string } | null;
  funcionarios?: { nome: string } | null;
  origens_venda?: { nome: string } | null;
  formas_pagamento?: { nome: string } | null;
  formas_pagamento_mensalidade?: { nome: string } | null;
  contrato_pai?: { numero: string } | null;
}

interface ContratoItem {
  id: string;
  contrato_id: string;
  descricao: string | null;
  vlr_ativacao: number | null;
  vlr_mensal: number | null;
}

const fmtBRL = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const [y, m, day] = d.split("T")[0].split("-");
  return `${day}/${m}/${y}`;
};

const NONE = "__none__";

export default function ClienteContratosSection({ clienteId }: Props) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const qc = useQueryClient();

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<{ open: boolean; edit?: Contrato | null }>({ open: false });
  const [cancelDialog, setCancelDialog] = useState<{ open: boolean; contrato: Contrato | null }>({ open: false, contrato: null });
  const [reativarDialog, setReativarDialog] = useState<{ open: boolean; contrato: Contrato | null }>({ open: false, contrato: null });

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setCurrentUserId(data?.user?.id ?? null)); }, []);
  const { data: currentProfile } = useProfile(currentUserId ?? undefined);
  const isAdminOrHead = currentProfile?.role === "admin" || currentProfile?.role === "head" || currentProfile?.is_super_admin === true;

  const tf = (q: any) => (tid ? q.eq("tenant_id", tid) : q);

  const motivosCancelamentoQuery = useQuery({
    queryKey: ["motivos_cancelamento", tid],
    queryFn: async () => {
      const { data, error } = await tf(
        (supabase.from("motivos_cancelamento" as any) as any).select("id, nome").order("nome")
      );
      if (error) throw error;
      return (data ?? []) as Array<{ id: number; nome: string }>;
    },
    staleTime: 30 * 60 * 1000,
  });

  const contratosQuery = useQuery({
    queryKey: ["contratos_cliente", tid, clienteId],
    queryFn: async () => {
      const { data, error } = await tf(
        (supabase.from("contratos" as any) as any)
          .select(
            `*,
             modelos_contrato:modelo_contrato_id(nome),
             funcionarios:funcionario_id(nome),
             origens_venda:origem_venda_id(nome),
             formas_pagamento:forma_pagamento_ativacao_id(nome),
             formas_pagamento_mensalidade:forma_pagamento_mensalidade_id(nome),
             contrato_pai:contrato_pai_id(numero)`
          )
          .eq("cliente_id", clienteId)
          .order("numero", { ascending: false })
      );
      if (error) throw error;
      return (data ?? []) as Contrato[];
    },
    enabled: !!clienteId,
  });

  const contratoIds = useMemo(
    () => (contratosQuery.data ?? []).map((c) => c.id),
    [contratosQuery.data]
  );

  const itensQuery = useQuery({
    queryKey: ["contrato_itens_cliente", tid, clienteId, contratoIds],
    queryFn: async () => {
      const { data, error } = await (supabase.from("contrato_itens" as any) as any)
        .select("*")
        .in("contrato_id", contratoIds)
        .order("descricao");
      if (error) throw error;
      return (data ?? []) as ContratoItem[];
    },
    enabled: contratoIds.length > 0,
  });

  const itensByContrato = useMemo(() => {
    const map: Record<string, ContratoItem[]> = {};
    (itensQuery.data ?? []).forEach((it) => {
      (map[it.contrato_id] ||= []).push(it);
    });
    return map;
  }, [itensQuery.data]);

  // Lookups
  const modelosQuery = useQuery({
    queryKey: ["modelos_contrato_lookup", tid],
    queryFn: async () => {
      const { data, error } = await tf(
        (supabase.from("modelos_contrato") as any).select("id, nome").order("nome")
      );
      if (error) throw error;
      return (data ?? []) as Array<{ id: number; nome: string }>;
    },
    staleTime: 30 * 60 * 1000,
  });

  const funcionariosQuery = useQuery({
    queryKey: ["funcionarios_lookup_ct", tid],
    queryFn: async () => {
      const { data, error } = await tf(
        supabase.from("funcionarios").select("id, nome").eq("ativo", true).order("nome")
      );
      if (error) throw error;
      return (data ?? []) as Array<{ id: number; nome: string }>;
    },
    staleTime: 30 * 60 * 1000,
  });

  const origensQuery = useQuery({
    queryKey: ["origens_venda_lookup_ct", tid],
    queryFn: async () => {
      const { data, error } = await tf(
        (supabase.from("origens_venda") as any).select("id, nome").order("nome")
      );
      if (error) throw error;
      return (data ?? []) as Array<{ id: number; nome: string }>;
    },
    staleTime: 30 * 60 * 1000,
  });

  const formasPgtoQuery = useQuery({
    queryKey: ["formas_pgto_lookup_ct", tid],
    queryFn: async () => {
      const { data, error } = await tf(
        supabase.from("formas_pagamento").select("id, nome").order("nome")
      );
      if (error) throw error;
      return (data ?? []) as Array<{ id: number; nome: string }>;
    },
    staleTime: 30 * 60 * 1000,
  });

  const contratosBase = useMemo(
    () => (contratosQuery.data ?? []).filter((c) => c.tipo === "base"),
    [contratosQuery.data]
  );

  const ativosCount = useMemo(
    () => (contratosQuery.data ?? []).filter((c) => c.status === "ativo").length,
    [contratosQuery.data]
  );

  const invalidate = () => {
    // Contratos e itens do cliente atual
    qc.invalidateQueries({ queryKey: ["contratos_cliente", tid, clienteId] });
    qc.invalidateQueries({ queryKey: ["contrato_itens_cliente", tid, clienteId] });
    // Produtos e módulos (afetados por cancel/reativar)
    qc.invalidateQueries({ queryKey: ["cliente_produtos", tid, clienteId] });
    qc.invalidateQueries({ queryKey: ["cliente_produto_modulos", tid, clienteId] });
    qc.invalidateQueries({ queryKey: ["contratos_totais_check", tid, clienteId] });
    // Cliente individual (status, mensalidade)
    qc.invalidateQueries({ queryKey: ["cliente", clienteId] });
    // Lista de clientes (lista principal da página /clientes)
    qc.invalidateQueries({ queryKey: ["clientes"] });
    // Movimentos MRR (tab na página de clientes)
    qc.invalidateQueries({ queryKey: ["movimentos_mrr_list"] });
    // Dashboard principal (todos os indicadores)
    qc.invalidateQueries({ queryKey: ["unit-economics-saas"] });
    // Contrato eventos (timeline, histórico)
    qc.invalidateQueries({ queryKey: ["contrato_eventos"] });
  };

  const isLoading = contratosQuery.isLoading;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="h-5 w-5" />
          Contratos
          <Badge variant="secondary" className="ml-2">{ativosCount} ativo{ativosCount !== 1 ? "s" : ""}</Badge>
        </CardTitle>
        <Button
          type="button"
          size="sm"
          onClick={() => setDialog({ open: true, edit: null })}
        >
          <Plus className="h-4 w-4 mr-1" /> Novo Contrato
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : (contratosQuery.data ?? []).length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Nenhum contrato registrado para este cliente.
          </div>
        ) : (
          <div className="space-y-2">
            {(contratosQuery.data ?? []).map((c) => {
              const isOpen = !!expanded[c.id];
              const itens = itensByContrato[c.id] ?? [];
              return (
                <Collapsible
                  key={c.id}
                  open={isOpen}
                  onOpenChange={(v) => setExpanded((s) => ({ ...s, [c.id]: v }))}
                  className="border rounded-md"
                >
                  <div className="flex items-center gap-2 p-3">
                    <CollapsibleTrigger asChild>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                    </CollapsibleTrigger>
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-5 gap-2 items-center min-w-0">
                      <div className="min-w-0">
                        <div className="font-mono font-semibold text-sm truncate">{c.numero}</div>
                        {c.tipo === "aditivo" && c.contrato_pai?.numero && (
                          <div className="text-xs text-muted-foreground truncate">
                            Aditivo de {c.contrato_pai.numero}
                          </div>
                        )}
                      </div>
                      <div>
                        <Badge variant={c.tipo === "base" ? "default" : "outline"} className="shrink-0">
                          {c.tipo === "base" ? "Base" : "Aditivo"}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground truncate">
                        {fmtDate(c.data_venda)}
                      </div>
                      <div>
                        <Badge variant="secondary" className="shrink-0">
                          R$ {fmtBRL(Number(c.vlr_total_mensal))}/mês
                        </Badge>
                      </div>
                      <div>
                        <Badge
                          variant={c.status === "ativo" ? "default" : "destructive"}
                          className={c.status === "ativo" ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                        >
                          {c.status === "ativo" ? "Ativo" : "Cancelado"}
                        </Badge>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => setDialog({ open: true, edit: c })}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {isAdminOrHead && c.status === "ativo" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                        title="Cancelar contrato"
                        onClick={(e) => { e.stopPropagation(); setCancelDialog({ open: true, contrato: c }); }}
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    )}
                    {isAdminOrHead && c.status === "cancelado" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-emerald-500 hover:text-emerald-600"
                        title="Reativar contrato"
                        onClick={(e) => { e.stopPropagation(); setReativarDialog({ open: true, contrato: c }); }}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  <CollapsibleContent>
                    <div className="px-4 pb-4 space-y-4">
                      <Separator />
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <DetailItem label="Modelo" value={c.modelos_contrato?.nome} />
                        <DetailItem label="Recorrência" value={c.recorrencia} />
                        <DetailItem label="Consultor" value={c.funcionarios?.nome} />
                        <DetailItem label="Origem Venda" value={c.origens_venda?.nome} />
                        <DetailItem label="Forma Pgto Ativação" value={c.formas_pagamento?.nome} />
                        <DetailItem label="Forma Pgto Mensalidade" value={c.formas_pagamento_mensalidade?.nome} />
                        <DetailItem label="Dia Vencimento" value={c.dia_vencimento ?? "—"} />
                        <DetailItem label="Data Início" value={fmtDate(c.data_inicio)} />
                        <DetailItem label="Data Fim" value={c.data_fim ? fmtDate(c.data_fim) : "Indeterminado"} />
                        <DetailItem label="Prazo (meses)" value={c.prazo_meses ?? "—"} />
                        <DetailItem label="Fidelidade (meses)" value={c.fidelidade_meses ?? "—"} />
                        <DetailItem label="Próx. Reajuste" value={fmtDate(c.data_proximo_reajuste)} />
                        <DetailItem label="Índice Reajuste" value={c.indice_reajuste} />
                        <DetailItem label="Vlr Total Ativação" value={`R$ ${fmtBRL(Number(c.vlr_total_ativacao))}`} />
                        <DetailItem label="Assinado em" value={fmtDate(c.assinado_em)} />
                        <div className="col-span-2 md:col-span-2">
                          <div className="text-xs text-muted-foreground">Link Assinatura</div>
                          {c.link_assinatura ? (
                            <a
                              href={c.link_assinatura}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-primary hover:underline text-sm break-all"
                            >
                              {c.link_assinatura}
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                          ) : (
                            <div className="text-sm">—</div>
                          )}
                        </div>
                      </div>

                      {c.observacoes && (
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Observações</div>
                          <div className="text-sm text-muted-foreground whitespace-pre-wrap">{c.observacoes}</div>
                        </div>
                      )}

                      {c.status === "cancelado" && (
                        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
                          <div className="font-medium text-destructive">Cancelado em {fmtDate(c.cancelado_em)}</div>
                          {c.motivo_cancelamento && (
                            <div className="text-muted-foreground mt-1">Motivo: {c.motivo_cancelamento}</div>
                          )}
                        </div>
                      )}

                      <Separator />
                      <div>
                        <div className="text-sm font-medium mb-2">Itens do Contrato</div>
                        <div className="overflow-x-auto">
                          {itens.length === 0 ? (
                            <div className="text-sm text-muted-foreground py-2">Nenhum item registrado</div>
                          ) : (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Descrição</TableHead>
                                  <TableHead className="text-right">Vlr Mensal</TableHead>
                                  <TableHead className="text-right">Vlr Ativação</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {itens.map((it) => (
                                  <TableRow key={it.id}>
                                    <TableCell>{it.descricao || "—"}</TableCell>
                                    <TableCell className="text-right">R$ {fmtBRL(Number(it.vlr_mensal))}</TableCell>
                                    <TableCell className="text-right">R$ {fmtBRL(Number(it.vlr_ativacao))}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )}
                        </div>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        )}
      </CardContent>

      {dialog.open && (
        <ContratoDialog
          open={dialog.open}
          onOpenChange={(v) => setDialog({ open: v, edit: v ? dialog.edit : null })}
          edit={dialog.edit ?? null}
          clienteId={clienteId}
          tid={tid}
          contratosBase={contratosBase}
          modelos={modelosQuery.data ?? []}
          funcionarios={funcionariosQuery.data ?? []}
          origens={origensQuery.data ?? []}
          formasPgto={formasPgtoQuery.data ?? []}
          onSaved={() => {
            invalidate();
            setDialog({ open: false });
          }}
        />
      )}

      <CancelarContratoDialog
        open={cancelDialog.open}
        onOpenChange={(v) => setCancelDialog({ open: v, contrato: v ? cancelDialog.contrato : null })}
        contrato={cancelDialog.contrato}
        clienteNome=""
        motivosCancelamento={motivosCancelamentoQuery.data ?? []}
        ativosCount={ativosCount}
        tid={tid}
        onSuccess={() => {
          invalidate();
          setCancelDialog({ open: false, contrato: null });
        }}
      />
      <ReativarContratoDialog
        open={reativarDialog.open}
        onOpenChange={(v) => setReativarDialog({ open: v, contrato: v ? reativarDialog.contrato : null })}
        contrato={reativarDialog.contrato}
        clienteNome=""
        ativosCount={ativosCount}
        onSuccess={() => {
          invalidate();
          qc.invalidateQueries({ queryKey: ["cliente", clienteId] });
          setReativarDialog({ open: false, contrato: null });
        }}
      />
    </Card>
  );
}

function DetailItem({ label, value }: { label: string; value: any }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm truncate">{value ?? "—"}</div>
    </div>
  );
}

interface DialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  edit: Contrato | null;
  clienteId: string;
  tid: string | null | undefined;
  contratosBase: Contrato[];
  modelos: Array<{ id: number; nome: string }>;
  funcionarios: Array<{ id: number; nome: string }>;
  origens: Array<{ id: number; nome: string }>;
  formasPgto: Array<{ id: number; nome: string }>;
  onSaved: () => void;
}

function ContratoDialog({
  open, onOpenChange, edit, clienteId, tid,
  contratosBase, modelos, funcionarios, origens, formasPgto, onSaved,
}: DialogProps) {
  const [tipo, setTipo] = useState<"base" | "aditivo">("base");
  const [contratoPaiId, setContratoPaiId] = useState<string>(NONE);
  const [dataVenda, setDataVenda] = useState<string>("");
  const [dataInicio, setDataInicio] = useState<string>("");
  const [dataFim, setDataFim] = useState<string>("");
  const [prazoMeses, setPrazoMeses] = useState<string>("");
  const [fidelidadeMeses, setFidelidadeMeses] = useState<string>("");
  const [recorrencia, setRecorrencia] = useState<string>("mensal");
  const [modeloContratoId, setModeloContratoId] = useState<string>(NONE);
  const [funcionarioId, setFuncionarioId] = useState<string>(NONE);
  const [origemVendaId, setOrigemVendaId] = useState<string>(NONE);
  const [formaPgtoId, setFormaPgtoId] = useState<string>(NONE);
  const [formaPgtoMensalidadeId, setFormaPgtoMensalidadeId] = useState<string>("");
  const [diaVencimento, setDiaVencimento] = useState<string>("");
  const [vlrMensal, setVlrMensal] = useState<number | null>(null);
  const [vlrAtivacao, setVlrAtivacao] = useState<number | null>(null);
  const [dataProxReajuste, setDataProxReajuste] = useState<string>("");
  const [indiceReajuste, setIndiceReajuste] = useState<string>(NONE);
  const [linkAssinatura, setLinkAssinatura] = useState<string>("");
  const [assinadoEm, setAssinadoEm] = useState<string>("");
  const [obs, setObs] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    if (edit) {
      setTipo((edit.tipo as any) || "base");
      setContratoPaiId(edit.contrato_pai_id ?? NONE);
      setDataVenda(edit.data_venda ?? "");
      setDataInicio(edit.data_inicio ?? "");
      setDataFim(edit.data_fim ?? "");
      setPrazoMeses(edit.prazo_meses?.toString() ?? "");
      setFidelidadeMeses(edit.fidelidade_meses?.toString() ?? "");
      setRecorrencia(edit.recorrencia ?? "mensal");
      setModeloContratoId(edit.modelo_contrato_id?.toString() ?? NONE);
      setFuncionarioId(edit.funcionario_id?.toString() ?? NONE);
      setOrigemVendaId(edit.origem_venda_id?.toString() ?? NONE);
      setFormaPgtoId(edit.forma_pagamento_ativacao_id?.toString() ?? NONE);
      setFormaPgtoMensalidadeId(edit.forma_pagamento_mensalidade_id ? String(edit.forma_pagamento_mensalidade_id) : "");
      setDiaVencimento(edit.dia_vencimento != null ? String(edit.dia_vencimento) : "");
      setVlrMensal(edit.vlr_total_mensal != null ? Number(edit.vlr_total_mensal) : null);
      setVlrAtivacao(edit.vlr_total_ativacao != null ? Number(edit.vlr_total_ativacao) : null);
      setDataProxReajuste(edit.data_proximo_reajuste ?? "");
      setIndiceReajuste(edit.indice_reajuste ?? NONE);
      setLinkAssinatura(edit.link_assinatura ?? "");
      setAssinadoEm(edit.assinado_em ?? "");
      setObs(edit.observacoes ?? "");
    } else {
      setTipo("base");
      setContratoPaiId(NONE);
      setDataVenda(""); setDataInicio(""); setDataFim("");
      setPrazoMeses(""); setFidelidadeMeses("");
      setRecorrencia("mensal");
      setModeloContratoId(NONE); setFuncionarioId(NONE);
      setOrigemVendaId(NONE); setFormaPgtoId(NONE);
      setFormaPgtoMensalidadeId(""); setDiaVencimento("");
      setVlrMensal(null); setVlrAtivacao(null);
      setDataProxReajuste(""); setIndiceReajuste(NONE);
      setLinkAssinatura(""); setAssinadoEm(""); setObs("");
    }
  }, [open, edit]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const num = (s: string) => (s.trim() === "" ? null : Number(s));
      const idOrNull = (s: string) => (s === NONE || s === "" ? null : Number(s));
      const payload: any = {
        tipo,
        contrato_pai_id: tipo === "aditivo" ? (contratoPaiId === NONE ? null : contratoPaiId) : null,
        data_venda: dataVenda || null,
        data_inicio: dataInicio || null,
        data_fim: dataFim || null,
        data_proximo_reajuste: dataProxReajuste || null,
        prazo_meses: num(prazoMeses),
        fidelidade_meses: num(fidelidadeMeses),
        indice_reajuste: indiceReajuste === NONE ? null : indiceReajuste,
        modelo_contrato_id: idOrNull(modeloContratoId),
        recorrencia,
        funcionario_id: idOrNull(funcionarioId),
        origem_venda_id: idOrNull(origemVendaId),
        forma_pagamento_ativacao_id: idOrNull(formaPgtoId),
        forma_pagamento_mensalidade_id: formaPgtoMensalidadeId ? Number(formaPgtoMensalidadeId) : null,
        dia_vencimento: diaVencimento ? Number(diaVencimento) : null,
        vlr_total_mensal: vlrMensal,
        vlr_total_ativacao: vlrAtivacao,
        link_assinatura: linkAssinatura || null,
        assinado_em: assinadoEm || null,
        observacoes: obs || null,
      };
      if (edit) {
        const { error } = await (supabase.from("contratos" as any) as any)
          .update(payload).eq("id", edit.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from("contratos" as any) as any)
          .insert({
            ...payload,
            tenant_id: tid,
            cliente_id: clienteId,
            status: "ativo",
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: edit ? "Contrato atualizado" : "Contrato criado" });
      onSaved();
    },
    onError: (e: any) => {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{edit ? "Editar Contrato" : "Novo Contrato"}</DialogTitle>
          <DialogDescription>
            Cadastre dados de contrato. O número é gerado automaticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Tipo e Identificação */}
          <Section title="Tipo e Identificação">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Tipo">
                <Select value={tipo} onValueChange={(v: any) => setTipo(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="base">Base</SelectItem>
                    <SelectItem value="aditivo">Aditivo</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {tipo === "aditivo" && (
                <Field label="Contrato Pai">
                  <Select value={contratoPaiId} onValueChange={setContratoPaiId}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— Nenhum —</SelectItem>
                      {contratosBase
                        .filter((c) => !edit || c.id !== edit.id)
                        .map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.numero}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              {edit && (
                <Field label="Número">
                  <Input value={edit.numero} readOnly className="font-mono" />
                </Field>
              )}
            </div>
          </Section>

          {/* Datas e Comercial */}
          <Section title="Datas">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Data Venda">
                <Input type="date" value={dataVenda} onChange={(e) => setDataVenda(e.target.value)} />
              </Field>
              <Field label="Data Início">
                <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
              </Field>
              <Field label="Data Fim">
                <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} placeholder="Indeterminado" />
              </Field>
              <Field label="Prazo (meses)">
                <Input type="number" value={prazoMeses} onChange={(e) => setPrazoMeses(e.target.value)} />
              </Field>
              <Field label="Fidelidade (meses)">
                <Input type="number" value={fidelidadeMeses} onChange={(e) => setFidelidadeMeses(e.target.value)} />
              </Field>
              <Field label="Recorrência">
                <Select value={recorrencia} onValueChange={setRecorrencia}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mensal">Mensal</SelectItem>
                    <SelectItem value="anual">Anual</SelectItem>
                    <SelectItem value="semestral">Semestral</SelectItem>
                    <SelectItem value="semanal">Semanal</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </Section>

          {/* Comercial */}
          <Section title="Comercial">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Modelo Contrato">
                <Select value={modeloContratoId} onValueChange={setModeloContratoId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— Nenhum —</SelectItem>
                    {modelos.map((m) => <SelectItem key={m.id} value={m.id.toString()}>{m.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Consultor">
                <Select value={funcionarioId} onValueChange={setFuncionarioId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— Nenhum —</SelectItem>
                    {funcionarios.map((f) => <SelectItem key={f.id} value={f.id.toString()}>{f.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Origem Venda">
                <Select value={origemVendaId} onValueChange={setOrigemVendaId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— Nenhum —</SelectItem>
                    {origens.map((o) => <SelectItem key={o.id} value={o.id.toString()}>{o.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Forma Pgto Ativação">
                <Select value={formaPgtoId} onValueChange={setFormaPgtoId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— Nenhum —</SelectItem>
                    {formasPgto.map((f) => <SelectItem key={f.id} value={f.id.toString()}>{f.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Forma Pgto Mensalidade">
                <Select
                  value={formaPgtoMensalidadeId === "" ? NONE : formaPgtoMensalidadeId}
                  onValueChange={(v) => setFormaPgtoMensalidadeId(v === NONE ? "" : v)}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— Nenhum —</SelectItem>
                    {formasPgto.map((f) => <SelectItem key={f.id} value={f.id.toString()}>{f.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Dia Vencimento">
                <Input
                  type="number"
                  min={1}
                  max={31}
                  placeholder="Dia"
                  value={diaVencimento}
                  onChange={(e) => setDiaVencimento(e.target.value)}
                />
              </Field>
            </div>
          </Section>

          {/* Valores */}
          <Section title="Valores">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Vlr Total Mensal">
                <NumericInput value={vlrMensal} onChange={setVlrMensal} />
              </Field>
              <Field label="Vlr Total Ativação">
                <NumericInput value={vlrAtivacao} onChange={setVlrAtivacao} />
              </Field>
            </div>
          </Section>

          {/* Reajuste */}
          <Section title="Reajuste">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Data Próximo Reajuste">
                <Input type="date" value={dataProxReajuste} onChange={(e) => setDataProxReajuste(e.target.value)} />
              </Field>
              <Field label="Índice Reajuste">
                <Select value={indiceReajuste} onValueChange={setIndiceReajuste}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— Nenhum —</SelectItem>
                    <SelectItem value="IGPM">IGPM</SelectItem>
                    <SelectItem value="IPCA">IPCA</SelectItem>
                    <SelectItem value="Personalizado">Personalizado</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </Section>

          {/* Assinatura */}
          <Section title="Assinatura">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Link Assinatura">
                <Input
                  value={linkAssinatura}
                  onChange={(e) => setLinkAssinatura(e.target.value)}
                  placeholder="https://app.d4sign.com/..."
                />
              </Field>
              <Field label="Data Assinatura">
                <Input type="date" value={assinadoEm} onChange={(e) => setAssinadoEm(e.target.value)} />
              </Field>
            </div>
          </Section>

          <Field label="Observações">
            <Textarea rows={3} value={obs} onChange={(e) => setObs(e.target.value)} />
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

// ============================================================
// CancelarContratoDialog
// ============================================================
interface CancelarContratoDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contrato: Contrato | null;
  clienteNome: string;
  motivosCancelamento: Array<{ id: number; nome: string }>;
  ativosCount: number;
  tid: string | null | undefined;
  onSuccess: () => void;
}

function CancelarContratoDialog({
  open, onOpenChange, contrato, motivosCancelamento, ativosCount, onSuccess,
}: CancelarContratoDialogProps) {
  const [motivoId, setMotivoId] = useState<string>("");
  const [observacao, setObservacao] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setMotivoId("");
      setObservacao("");
      setConfirmacao("");
    }
  }, [open, contrato?.id]);

  const itensQuery = useQuery({
    queryKey: ["contrato_itens_cancel", contrato?.id],
    enabled: !!contrato?.id && open,
    queryFn: async () => {
      const { data, error } = await (supabase.from("contrato_itens" as any) as any)
        .select("id, descricao, vlr_mensal")
        .eq("contrato_id", contrato!.id);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; descricao: string | null; vlr_mensal: number | null }>;
    },
  });

  const isUltimoAtivo = ativosCount <= 1 && contrato?.status === "ativo";
  const matches = contrato ? confirmacao.trim() === contrato.numero.trim() : false;
  const canSubmit = !!motivoId && matches && !loading && !!contrato;

  const handleConfirm = async () => {
    if (!canSubmit || !contrato) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase.rpc as any)("cancelar_contrato", {
        p_contrato_id: contrato.id,
        p_motivo_id: Number(motivoId),
        p_observacao: observacao.trim() || null,
      });
      if (error) throw error;
      const result = data as any;
      toast({
        title: "Contrato cancelado",
        description: `MRR Churn: R$ ${fmtBRL(Number(result?.mrr_churn ?? 0))}`,
      });
      if (result?.cliente_cancelado) {
        toast({ title: "Cliente marcado como cancelado" });
      }
      onSuccess();
    } catch (err: any) {
      toast({
        title: "Erro ao cancelar contrato",
        description: err?.message || "Tente novamente",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!contrato) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-destructive" />
            Cancelar contrato {contrato.numero}
          </DialogTitle>
          <DialogDescription>
            Esta ação cancela o contrato e inativa os produtos vinculados.
          </DialogDescription>
        </DialogHeader>

        {isUltimoAtivo && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 flex gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              <strong>Este é o último contrato ativo.</strong> O cliente será marcado como cancelado.
            </p>
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Motivo do cancelamento *</Label>
            <Select value={motivoId} onValueChange={setMotivoId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o motivo" />
              </SelectTrigger>
              <SelectContent>
                {motivosCancelamento.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Observação (opcional)</Label>
            <Textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Detalhes adicionais..."
            />
          </div>

          {itensQuery.data && itensQuery.data.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">Produtos que serão inativados</Label>
              <div className="rounded-md border divide-y max-h-40 overflow-y-auto">
                {itensQuery.data.map((it) => (
                  <div key={it.id} className="flex items-center justify-between p-2 text-xs">
                    <span className="truncate">{it.descricao || "—"}</span>
                    <span className="font-mono text-muted-foreground shrink-0 ml-2">
                      R$ {fmtBRL(Number(it.vlr_mensal))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">
              Para confirmar, digite o número do contrato:{" "}
              <span className="font-mono text-foreground">{contrato.numero}</span>
            </Label>
            <Input
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              placeholder={contrato.numero}
              autoComplete="off"
            />
            {confirmacao && !matches && (
              <p className="text-[10px] text-destructive">Número não confere.</p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Voltar
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!canSubmit}>
            <XCircle className="h-4 w-4 mr-2" />
            {loading ? "Cancelando..." : "Cancelar contrato"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// ReativarContratoDialog
// ============================================================
interface ReativarContratoDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contrato: Contrato | null;
  clienteNome: string;
  ativosCount: number;
  onSuccess: () => void;
}

function ReativarContratoDialog({
  open, onOpenChange, contrato, ativosCount, onSuccess,
}: ReativarContratoDialogProps) {
  const [observacao, setObservacao] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setObservacao("");
      setConfirmacao("");
    }
  }, [open, contrato?.id]);

  const clienteEstaCancelado = ativosCount === 0;
  const matches = contrato ? confirmacao.trim() === contrato.numero.trim() : false;
  const canSubmit = matches && !loading && !!contrato;

  const handleConfirm = async () => {
    if (!canSubmit || !contrato) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase.rpc as any)("reativar_contrato", {
        p_contrato_id: contrato.id,
        p_observacao: observacao.trim() || null,
      });
      if (error) throw error;
      const result = data as any;
      toast({
        title: "Contrato reativado",
        description: `MRR: +R$ ${fmtBRL(Number(result?.mrr_reactivation ?? 0))}`,
      });
      if (result?.cliente_reativado) {
        toast({ title: "Cliente reativado" });
      }
      onSuccess();
    } catch (err: any) {
      toast({
        title: "Erro ao reativar contrato",
        description: err?.message || "Tente novamente",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!contrato) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-emerald-500" />
            Reativar contrato {contrato.numero}
          </DialogTitle>
          <DialogDescription>
            O contrato <span className="font-mono">{contrato.numero}</span> e seus produtos vinculados serão reativados.
            {clienteEstaCancelado && " O cliente voltará ao status ativo."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Observação (opcional)</Label>
            <Textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Detalhes adicionais sobre a reativação..."
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">
              Para confirmar, digite o número do contrato:{" "}
              <span className="font-mono text-foreground">{contrato.numero}</span>
            </Label>
            <Input
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              placeholder={contrato.numero}
              autoComplete="off"
            />
            {confirmacao && !matches && (
              <p className="text-[10px] text-destructive">Número não confere.</p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Voltar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {loading ? "Reativando..." : "Reativar contrato"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
