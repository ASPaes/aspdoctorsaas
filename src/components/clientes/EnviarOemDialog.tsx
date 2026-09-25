import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Clock, Loader2, Search, Send } from "lucide-react";

// ============================================================================
// Licença NOVA no OEM para um produto do cliente.
//
// Nada daqui vai direto ao parceiro: o botão cria um pedido `criar_licenca`
// na fila, que espera aprovação em Clientes › Aprovação OEM (regra do
// Alexandre, 25/09/2026 — criar licença gera cobrança no parceiro). Quem
// fala com o OEM é o processador, depois de aprovado.
//
// Os módulos que vão são os da FICHA (fn_oem_licenca_contexto), não os que a
// tela mandar. Tipo de negócio, detalhe e origem da venda são obrigatórios no
// OEM; as listas vêm do parceiro e o padrão é o último pedido desta conta.
// ============================================================================

type Opcao = { codigo: string; nome: string };

type Contexto = {
  tem_licenca: boolean;
  conta_id: string | null;
  produto_codigo: string | null;
  produto_nome: string | null;
  cliente: { nome_fantasia: string | null; razao_social: string | null; cnpj: string | null; email: string | null };
  modulos: { nome: string; codigo: number; quantidade: number; custo_unit: number | null }[];
  modulos_sem_codigo: string[];
  custo_previsto: number;
  pedido_vivo: { id: string; status: string; ultimo_erro: string | null } | null;
  padroes: { tipo_negocio?: number; detalhe_tipo_negocio?: number; origem_venda?: number };
};

type Grupo = { codigo: string; nome: string; cnpj: string | null; filiais: number };

const brl = (v: number | null | undefined) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const soDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

const mascaraDoc = (v: string | null | undefined) => {
  const d = soDigitos(v);
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return v ?? "";
};

// "Não definido" (código 0) existe nas listas do parceiro, mas não é escolha:
// a licença nasceria sem tipo de negócio.
const semNaoDefinido = (l: Opcao[] | undefined) => (l ?? []).filter((o) => String(o.codigo) !== "0");

export function useContextoLicencaOem(clienteProdutoId: string | null, enabled = true) {
  return useQuery<Contexto>({
    queryKey: ["oem-licenca-contexto", clienteProdutoId],
    enabled: enabled && !!clienteProdutoId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("fn_oem_licenca_contexto", {
        p_cliente_produto_id: clienteProdutoId,
      });
      if (error) throw error;
      return data as Contexto;
    },
  });
}

/** Rótulo curto de um pedido de licença em andamento. */
function situacaoDoPedido(status: string) {
  switch (status) {
    case "aguardando_aprovacao": return "Licença OEM aguardando aprovação";
    case "pendente":
    case "processando": return "Licença OEM sendo criada";
    default: return "Licença OEM não foi criada";
  }
}

// ----------------------------------------------------------------------------
// O bloco do card do produto: botão, pedido em andamento, ou o aviso antigo.
// ----------------------------------------------------------------------------
export function LicencaOemDoProduto({ clienteProdutoId, ativo }: { clienteProdutoId: string; ativo: boolean }) {
  const [aberto, setAberto] = useState(false);
  const ctxQ = useContextoLicencaOem(clienteProdutoId, ativo);
  const ctx = ctxQ.data;

  const avisoAntigo = (
    <p className="text-xs text-muted-foreground">
      Sem licença do OEM vinculada. O código é gravado aqui quando o vínculo é
      feito em <strong>Configurações › Integrações › OEM</strong> — não se
      preenche à mão.
    </p>
  );

  if (!ativo || ctxQ.isLoading) return avisoAntigo;
  // Produto que não é do OEM, ou unidade sem conta: não há licença a pedir.
  if (!ctx || !ctx.conta_id || !ctx.produto_codigo) return avisoAntigo;

  if (ctx.pedido_vivo) {
    const falhou = ctx.pedido_vivo.status === "invalido" || ctx.pedido_vivo.status === "erro";
    return (
      <div className="flex flex-wrap items-start gap-2 text-xs">
        <Badge variant="outline" className={falhou
          ? "border-destructive/40 text-destructive"
          : "border-amber-500/40 text-amber-600 dark:text-amber-400"}>
          {falhou ? <AlertTriangle className="mr-1 h-3 w-3" /> : <Clock className="mr-1 h-3 w-3" />}
          {situacaoDoPedido(ctx.pedido_vivo.status)}
        </Badge>
        {falhou && ctx.pedido_vivo.ultimo_erro && (
          <span className="text-muted-foreground">{ctx.pedido_vivo.ultimo_erro}</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" className="gap-1.5" onClick={() => setAberto(true)}>
        <Send className="h-3.5 w-3.5" /> Enviar ao OEM
      </Button>
      <span className="text-xs text-muted-foreground">
        Este produto ainda não tem licença no OEM. O pedido passa pela aprovação antes de ir ao parceiro.
      </span>
      <EnviarOemDialog clienteProdutoId={clienteProdutoId} open={aberto} onClose={() => setAberto(false)} />
    </div>
  );
}

// ----------------------------------------------------------------------------
// O diálogo
// ----------------------------------------------------------------------------
export default function EnviarOemDialog({
  clienteProdutoId, open, onClose, onEnviado,
}: {
  clienteProdutoId: string;
  open: boolean;
  onClose: () => void;
  onEnviado?: () => void;
}) {
  const qc = useQueryClient();
  const ctxQ = useContextoLicencaOem(clienteProdutoId, open);
  const ctx = ctxQ.data;

  const opcoesQ = useQuery({
    queryKey: ["oem-licenca-opcoes", clienteProdutoId],
    enabled: open && !!ctx?.conta_id,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("oem-sync-processar", {
        body: { acao: "opcoes_licenca", cliente_produto_id: clienteProdutoId },
      });
      if (error) throw error;
      const l = (data as any)?.listas;
      if (!(data as any)?.ok || !l) throw new Error((data as any)?.listas?.mensagem ?? "O OEM não devolveu as listas.");
      return {
        tipos: semNaoDefinido(l.tipos_negocio as Opcao[]),
        detalhes: (l.detalhes_tipo_negocio ?? {}) as Record<string, Opcao[]>,
        origens: semNaoDefinido(l.origens_venda as Opcao[]),
      };
    },
  });

  const [modo, setModo] = useState<"avulsa" | "grupo">("grupo");
  const [busca, setBusca] = useState("");
  const [grupo, setGrupo] = useState<Grupo | null>(null);
  const [nomeLoja, setNomeLoja] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [email, setEmail] = useState("");
  const [tipo, setTipo] = useState("");
  const [detalhe, setDetalhe] = useState("");
  const [origem, setOrigem] = useState("");
  const [enviando, setEnviando] = useState(false);

  // Preenche com o cadastro do cliente e o último pedido desta conta, uma vez
  // por abertura. Quem já digitou não tem o campo reescrito.
  useEffect(() => {
    if (!open || !ctx) return;
    setNomeLoja((v) => v || ctx.cliente.nome_fantasia || ctx.cliente.razao_social || "");
    setCnpj((v) => v || mascaraDoc(ctx.cliente.cnpj));
    setEmail((v) => v || ctx.cliente.email || "");
    setTipo((v) => v || (ctx.padroes.tipo_negocio ? String(ctx.padroes.tipo_negocio) : ""));
    setDetalhe((v) => v || (ctx.padroes.detalhe_tipo_negocio ? String(ctx.padroes.detalhe_tipo_negocio) : ""));
    setOrigem((v) => v || (ctx.padroes.origem_venda ? String(ctx.padroes.origem_venda) : ""));
  }, [open, ctx]);

  useEffect(() => {
    if (open) return;
    setModo("grupo"); setBusca(""); setGrupo(null);
    setNomeLoja(""); setCnpj(""); setEmail("");
    setTipo(""); setDetalhe(""); setOrigem("");
  }, [open]);

  // Os grupos saem do espelho que já temos: a busca não chama o parceiro.
  const termo = busca.trim();
  const gruposQ = useQuery<Grupo[]>({
    queryKey: ["oem-grupos-busca", ctx?.conta_id, termo],
    enabled: open && modo === "grupo" && !!ctx?.conta_id && termo.length >= 2,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const dig = soDigitos(termo);
      const like = `%${termo.replace(/[%_,()]/g, " ")}%`;
      const filtros = [`grupo_economico.ilike.${like}`, `nome_fantasia.ilike.${like}`];
      if (dig.length >= 3) filtros.push(`cnpj_oem.ilike.%${dig}%`, `empresa_codigo.eq.${dig}`);
      const { data, error } = await (supabase.from("oem_espelho_filial" as any) as any)
        .select("empresa_codigo, grupo_economico, cnpj_oem, filial_codigo")
        .eq("conta_integration_id", ctx!.conta_id)
        .or(filtros.join(","))
        .limit(200);
      if (error) throw error;
      const porGrupo = new Map<string, Grupo>();
      for (const r of (data ?? []) as any[]) {
        const g = porGrupo.get(r.empresa_codigo);
        if (g) g.filiais += 1;
        else porGrupo.set(r.empresa_codigo, {
          codigo: String(r.empresa_codigo), nome: r.grupo_economico ?? "(sem nome)",
          cnpj: r.cnpj_oem ?? null, filiais: 1,
        });
      }
      return [...porGrupo.values()].slice(0, 20);
    },
  });

  const opcoes = opcoesQ.data;
  const detalhesDoTipo = useMemo(
    () => semNaoDefinido(tipo ? opcoes?.detalhes[tipo] : []),
    [opcoes, tipo],
  );
  // Detalhe é do tipo: trocar o tipo invalida o detalhe escolhido.
  useEffect(() => {
    if (!detalhe || !opcoes) return;
    if (!detalhesDoTipo.some((d) => String(d.codigo) === detalhe)) setDetalhe("");
  }, [detalhesDoTipo, detalhe, opcoes]);

  const nomeDe = (l: Opcao[] | undefined, cod: string) => l?.find((o) => String(o.codigo) === cod)?.nome ?? null;

  const faltando: string[] = [];
  if (modo === "grupo" && !grupo) faltando.push("o grupo");
  if (!nomeLoja.trim()) faltando.push("o nome da loja");
  if (![11, 14].includes(soDigitos(cnpj).length)) faltando.push("um CNPJ/CPF válido");
  if (modo === "avulsa" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) faltando.push("o e-mail");
  if (!tipo) faltando.push("o tipo de negócio");
  if (!detalhe) faltando.push("o detalhe");
  if (!origem) faltando.push("a origem da venda");

  const enviar = async () => {
    setEnviando(true);
    try {
      const { error } = await (supabase.rpc as any)("fn_oem_solicitar_licenca", {
        p_cliente_produto_id: clienteProdutoId,
        p_dados: {
          modo,
          grupo_codigo: modo === "grupo" ? grupo?.codigo : null,
          nome_loja: nomeLoja.trim(),
          cnpj_loja: soDigitos(cnpj),
          email: modo === "avulsa" ? email.trim() : null,
          tipo_negocio: Number(tipo),
          tipo_negocio_nome: nomeDe(opcoes?.tipos, tipo),
          detalhe_tipo_negocio: Number(detalhe),
          detalhe_nome: nomeDe(detalhesDoTipo, detalhe),
          origem_venda: Number(origem),
          origem_venda_nome: nomeDe(opcoes?.origens, origem),
        },
      });
      if (error) throw error;
      toast({ title: "Enviado para aprovação", description: "A licença é criada no OEM depois que o pedido for aprovado em Clientes › Aprovação OEM." });
      qc.invalidateQueries({ queryKey: ["oem-licenca-contexto", clienteProdutoId] });
      qc.invalidateQueries({ queryKey: ["oem-aprovacao-lista"] });
      qc.invalidateQueries({ queryKey: ["oem-aprovacao-status"] });
      onEnviado?.();
      onClose();
    } catch (e: any) {
      toast({ title: "Não foi possível enviar", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setEnviando(false);
    }
  };

  const bloqueio =
    !ctx ? null
      : ctx.tem_licenca ? "Este produto já tem licença no OEM."
        : ctx.pedido_vivo ? "Já existe um pedido de licença para este produto em andamento."
          : !ctx.conta_id ? "A unidade deste cliente não tem conta do OEM conectada."
            : !ctx.produto_codigo ? "Este produto não está ligado a um produto do OEM (Configurações › Integrações › OEM)."
              : ctx.modulos.length === 0 ? "O produto não tem nenhum módulo do OEM. Adicione os módulos antes de pedir a licença."
                : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enviar ao OEM</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Cria o pedido de licença. Ele vai para <strong>Clientes › Aprovação OEM</strong> e só chega ao parceiro depois de aprovado.
          </p>
        </DialogHeader>

        {ctxQ.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : ctxQ.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar os dados do produto.</p>
        ) : bloqueio ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{bloqueio}</p>
        ) : ctx && (
          <div className="space-y-4">
            {/* Como a licença nasce */}
            <div className="space-y-2">
              <Label>Como a licença nasce no OEM</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {([
                  ["grupo", "Filial de um grupo existente", "A licença nasce dentro de um grupo que já existe no OEM."],
                  ["avulsa", "Licença avulsa", "Cria um grupo novo no OEM só para este cliente."],
                ] as const).map(([valor, titulo, texto]) => (
                  <button
                    key={valor}
                    type="button"
                    onClick={() => setModo(valor)}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      modo === valor ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "hover:bg-muted/50"}`}
                    aria-pressed={modo === valor}
                  >
                    <div className="text-sm font-medium">{titulo}</div>
                    <div className="text-xs text-muted-foreground">{texto}</div>
                  </button>
                ))}
              </div>
            </div>

            {modo === "grupo" && (
              <div className="space-y-2">
                <Label htmlFor="oem-busca-grupo">Grupo</Label>
                {grupo ? (
                  <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 p-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{grupo.nome}</div>
                      <div className="text-xs text-muted-foreground">
                        Grupo {grupo.codigo}{grupo.cnpj ? ` · ${mascaraDoc(grupo.cnpj)}` : ""} · {grupo.filiais} {grupo.filiais === 1 ? "filial" : "filiais"}
                      </div>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setGrupo(null)}>Trocar</Button>
                  </div>
                ) : (
                  <div className="rounded-md border">
                    <div className="flex items-center gap-2 border-b px-2">
                      <Search className="h-4 w-4 text-muted-foreground" />
                      <Input
                        id="oem-busca-grupo"
                        className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                        placeholder="Nome, CNPJ ou código do grupo"
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        autoComplete="off"
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {termo.length < 2 ? (
                        <p className="p-3 text-xs text-muted-foreground">Digite ao menos 2 letras.</p>
                      ) : gruposQ.isLoading ? (
                        <p className="p-3 text-xs text-muted-foreground">Buscando…</p>
                      ) : (gruposQ.data ?? []).length === 0 ? (
                        <p className="p-3 text-xs text-muted-foreground">Nenhum grupo encontrado nesta conta do OEM.</p>
                      ) : (
                        (gruposQ.data ?? []).map((g) => (
                          <button
                            key={g.codigo}
                            type="button"
                            className="block w-full border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/50"
                            onClick={() => setGrupo(g)}
                          >
                            <div className="text-sm font-medium">{g.nome}</div>
                            <div className="text-xs text-muted-foreground">
                              Grupo {g.codigo}{g.cnpj ? ` · ${mascaraDoc(g.cnpj)}` : ""} · {g.filiais} {g.filiais === 1 ? "filial" : "filiais"}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="oem-nome-loja">Nome da loja no OEM</Label>
                <Input id="oem-nome-loja" value={nomeLoja} onChange={(e) => setNomeLoja(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="oem-cnpj-loja">CNPJ/CPF da loja</Label>
                <Input id="oem-cnpj-loja" value={cnpj} onChange={(e) => setCnpj(e.target.value)} inputMode="numeric" />
              </div>
              {modo === "avulsa" && (
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="oem-contato-grupo">E-mail do grupo novo</Label>
                  {/* Sem "email" no id: o autofill do Chrome escreveria nele. */}
                  <Input id="oem-contato-grupo" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {opcoesQ.isError ? (
                <p className="text-xs text-destructive sm:col-span-3">
                  Não foi possível ler as listas do OEM: {(opcoesQ.error as Error)?.message}
                </p>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label>Tipo de negócio</Label>
                    <Select value={tipo} onValueChange={setTipo} disabled={!opcoes}>
                      <SelectTrigger><SelectValue placeholder={opcoes ? "Selecione" : "Carregando…"} /></SelectTrigger>
                      <SelectContent>
                        {(opcoes?.tipos ?? []).map((o) => <SelectItem key={o.codigo} value={String(o.codigo)}>{o.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Detalhe</Label>
                    <Select value={detalhe} onValueChange={setDetalhe} disabled={!tipo}>
                      <SelectTrigger><SelectValue placeholder={tipo ? "Selecione" : "Escolha o tipo"} /></SelectTrigger>
                      <SelectContent>
                        {detalhesDoTipo.map((o) => <SelectItem key={o.codigo} value={String(o.codigo)}>{o.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Origem da venda</Label>
                    <Select value={origem} onValueChange={setOrigem} disabled={!opcoes}>
                      <SelectTrigger><SelectValue placeholder={opcoes ? "Selecione" : "Carregando…"} /></SelectTrigger>
                      <SelectContent>
                        {(opcoes?.origens ?? []).map((o) => <SelectItem key={o.codigo} value={String(o.codigo)}>{o.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>

            {/* O que vai, e quanto passa a custar. */}
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Vai para o OEM{ctx.produto_nome ? ` · ${ctx.produto_nome}` : ""}
              </div>
              <div>
                {ctx.modulos.map((m) => `${m.nome}${m.quantidade > 1 ? ` × ${m.quantidade}` : ""}`).join(", ")}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Custo previsto: <span className="font-medium text-foreground">{brl(ctx.custo_previsto)}/mês</span>, cobrado pelo parceiro a partir da criação.
              </div>
              {ctx.modulos_sem_codigo.length > 0 && (
                <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Não vão ao OEM por não terem código do parceiro: {ctx.modulos_sem_codigo.join(", ")}.
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {!bloqueio && ctx && faltando.length > 0 && (
            <span className="mr-auto self-center text-xs text-muted-foreground">Falta {faltando.join(", ")}.</span>
          )}
          <Button type="button" variant="outline" onClick={onClose} disabled={enviando}>Cancelar</Button>
          {!bloqueio && ctx && (
            <Button type="button" onClick={enviar} disabled={enviando || faltando.length > 0} className="gap-1.5">
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar para aprovação
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
