import { useEffect, useMemo, useState } from "react";
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
import { AlertTriangle, ExternalLink, Loader2, Download } from "lucide-react";
import { maskPhoneBR } from "@/lib/masks";
import { brl, cnpjMask, nomeTipo, num, rotuloRecorrencia } from "./ui";
import {
  contaVazia, contarFaltando, mensalidadeDoPortal, recorrenciaDoPlano, separarContas,
  type JaCadastrado, type PorConta,
} from "./importarRegras";
import type { LinhaRecon } from "./useHiperDados";

/**
 * Importar para o DoctorSaaS a conta que vive no portal Hiper e não tem
 * cadastro aqui.
 *
 * O portal dá razão social, fantasia, CNPJ, cidade/UF, plano, tipo de contrato
 * e custo. O resto do cadastro não existe lá e é perguntado aqui: o que é igual
 * para todas as contas fica no topo, o que muda de conta para conta fica no
 * cartão de cada uma.
 *
 * Mensalidade é campo obrigatório e não um palpite: em 9 das 12 contas o
 * responsável é o Hiperador, e nessas quem cobra o cliente é a revenda — o
 * portal não conhece o preço. Importar com zero encheria a base de cliente sem
 * receita e com custo saindo.
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
  const [enviando, setEnviando] = useState(false);

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
  const { data: existentes = [], isPending: checando } = useQuery({
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

  const { mapa: mapaExistente, novas, bloqueadas } = useMemo(
    () => separarContas(contas, existentes), [contas, existentes]);

  // Semeia a mensalidade que o portal conhece; o resto nasce vazio de propósito.
  useEffect(() => {
    if (!open) return;
    setPorConta((atual) => {
      const novo = { ...atual };
      for (const c of contas) {
        if (!novo[c.id]) novo[c.id] = { ...contaVazia, mensalidade: mensalidadeDoPortal(c) };
      }
      return novo;
    });
  }, [open, contas]);

  const editar = (id: string, campo: keyof PorConta, valor: string) =>
    setPorConta((s) => ({ ...s, [id]: { ...(s[id] ?? contaVazia), [campo]: valor } }));

  const faltando = useMemo(() => contarFaltando(novas, porConta), [novas, porConta]);

  const padraoOk = !!unidade && !!dataInicio;
  // `checando` conta: até a busca por CNPJ voltar, TODAS as contas parecem
  // novas. Mostrar 12 e cair para 7 um instante depois é pior do que esperar.
  const podeEnviar = padraoOk && !checando && novas.length > 0 && faltando === 0 && !enviando;

  const importar = async () => {
    setEnviando(true);
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
        p_itens: novas.map((c) => {
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

      const criados = (r.criados ?? []) as any[];
      const recusados = (r.recusados ?? []) as { conta: string; motivo: string }[];
      toast({
        title: criados.length === 0
          ? "Nenhuma conta foi importada"
          : `${num(criados.length)} ${criados.length === 1 ? "cliente criado" : "clientes criados"}`,
        // O recusado importa tanto quanto o criado: sem isso a pessoa acha que
        // importou 12 e importou 7.
        description: recusados.length
          ? `Não entraram: ${recusados.map((x) => `${x.conta} (${x.motivo})`).join(" · ")}`
          : "Contrato, custo e módulos vieram junto.",
        variant: criados.length === 0 ? "destructive" : undefined,
      });
      ["hiper_recon", "hiper_log", "clientes"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      if (criados.length > 0) onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Não foi possível importar", description: e.message, variant: "destructive" });
    } finally {
      setEnviando(false);
    }
  };

  const selectCls = "h-9 w-full rounded-md border bg-background px-3 text-sm";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>
            {checando
              ? "Importar contas do Hiper"
              : `Importar ${num(novas.length)} ${novas.length === 1 ? "conta" : "contas"} do Hiper`}
          </DialogTitle>
          <DialogDescription>
            Razão social, CNPJ, cidade, plano, tipo de contrato e custo vêm do portal.
            O que ele não tem é preenchido aqui. Fornecedor:{" "}
            <strong className="text-foreground">Hiper Software</strong>, o mesmo da integração.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4">
          {checando && (
            <p className="flex items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Conferindo quais CNPJs já têm cadastro aqui…
            </p>
          )}

          {!checando && (<>
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
                <p className="text-[11px] text-muted-foreground">Vale como venda e ativação — o portal não informa nenhuma das duas.</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Dia de vencimento</Label>
                <Input type="number" min={1} max={31} className="h-9" value={dia}
                  onChange={(e) => setDia(e.target.value)} placeholder="—" />
              </div>
            </div>
          </div>

          {/* ── conta a conta ─────────────────────────────────────────────── */}
          {novas.map((c) => {
            const d = porConta[c.id] ?? contaVazia;
            return (
              <div key={c.id} className="rounded-lg border p-3 space-y-3">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-medium text-sm">{c.razao_social_hiper}</span>
                  <span className="font-mono text-xs text-muted-foreground">{cnpjMask(c.cnpj_norm)}</span>
                  <Badge variant="secondary" className="text-[10px]">{c.plano_hiper}</Badge>
                  <Badge variant="outline" className="text-[10px]">{nomeTipo(c.responsavel_tipo)}</Badge>
                  {/* A recorrência sai do NOME do plano e precisa estar à vista:
                      é ela que evita o contrato anual entrar como mensal. Só
                      aparece quando não é mensal — rotuloRecorrencia devolve
                      null nesse caso, e concatenar deixaria um "·" solto. */}
                  {recorrenciaDoPlano(c.plano_hiper) !== "mensal" && (
                    <Badge variant="outline" className="text-[10px]">
                      {rotuloRecorrencia(recorrenciaDoPlano(c.plano_hiper))}
                    </Badge>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    custo {brl(c.custo_hiper)}/mês
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Mensalidade *</Label>
                    <Input className="h-9 tabular-nums" inputMode="decimal" placeholder="0,00"
                      value={d.mensalidade} onChange={(e) => editar(c.id, "mensalidade", e.target.value)} />
                    {!mensalidadeDoPortal(c) && (
                      <p className="text-[11px] text-muted-foreground">
                        O portal não informa: nesta conta quem cobra o cliente é você.
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">E-mail *</Label>
                    <Input className="h-9" type="email" placeholder="cliente@empresa.com.br"
                      value={d.email} onChange={(e) => editar(c.id, "email", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">WhatsApp *</Label>
                    <Input className="h-9" placeholder="(47) 99999-9999" value={d.whatsapp}
                      onChange={(e) => editar(c.id, "whatsapp", maskPhoneBR(e.target.value))} />
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
                </div>
              </div>
            );
          })}

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
              Nenhuma das contas selecionadas pode virar cadastro novo.
            </p>
          )}
          </>)}
        </div>

        <DialogFooter className="border-t px-6 py-4 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {checando
              ? "Conferindo os CNPJs…"
              : !padraoOk
              ? "Escolha a unidade base e a data de início."
              : faltando > 0
                ? `Faltam mensalidade, e-mail ou WhatsApp em ${num(faltando)} de ${num(novas.length)}.`
                : novas.length > 0
                  ? "Tudo preenchido."
                  : ""}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviando}>Cancelar</Button>
            <Button onClick={importar} disabled={!podeEnviar}>
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Importar{!checando && ` ${num(novas.length)}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
