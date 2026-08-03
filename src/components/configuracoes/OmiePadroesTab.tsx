import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Save, AlertCircle, Pause, CheckCircle2 } from "lucide-react";
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

type Opt = { codigo: string | number; descricao: string; cod_lc116?: string | null };

type Padroes = {
  conta_corrente_codigo?: string | null;
  conta_corrente_nome?: string | null;
  conta_corrente?: string | null;
  servico_omie_codigo?: string | null;
  servico_descricao?: string | null;
  servico_lc116?: string | null;
  tipo_faturamento_codigo?: string | null;
  tipo_faturamento_nome?: string | null;
  tipo_faturamento?: string | null;
  dia_faturamento?: number | null;
  numero_parcelas?: number | null;
  tipo_vencimento?: string | null;
  dia_vencimento?: number | null;
  postergar_vencimento?: boolean | null;
  enviar_link_nfse?: boolean | null;
  enviar_boleto?: boolean | null;
  postergar_finais_semana?: boolean | null;
  adicionar_periodo_referencia?: boolean | null;
  adicionar_vencimento_parcela?: boolean | null;
  modelos_permitidos?: string[] | null;
};

type ModeloContrato = { id: string; nome: string };

type LerResp = {
  ok: boolean;
  padroes?: Padroes;
  contas?: Opt[];
  servicos?: Opt[];
  tipos_faturamento?: Opt[];
  tipos_vencimento?: Opt[];
  error?: string;
};

export default function OmiePadroesTab() {
  const { toast } = useToast();
  const { effectiveTenantId: tid } = useTenantFilter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [contas, setContas] = useState<Opt[]>([]);
  const [servicos, setServicos] = useState<Opt[]>([]);
  const [tiposFaturamento, setTiposFaturamento] = useState<Opt[]>([]);
  const [tiposVencimento, setTiposVencimento] = useState<Opt[]>([]);

  // form state
  const [contaCodigo, setContaCodigo] = useState<string>("");
  const [servicoCodigo, setServicoCodigo] = useState<string>("");
  const [tipoFatCodigo, setTipoFatCodigo] = useState<string>("");
  const [diaFaturamento, setDiaFaturamento] = useState<string>("");
  const [numeroParcelas, setNumeroParcelas] = useState<string>("");
  const [tipoVencimento, setTipoVencimento] = useState<string>("");
  const [diaVencimento, setDiaVencimento] = useState<string>("");
  const [postergarVencimento, setPostergarVencimento] = useState(false);
  const [enviarLinkNfse, setEnviarLinkNfse] = useState(false);
  const [enviarBoleto, setEnviarBoleto] = useState(false);
  const [postergarFds, setPostergarFds] = useState(false);
  const [addPeriodoRef, setAddPeriodoRef] = useState(false);
  const [addVencParcela, setAddVencParcela] = useState(false);

  // Seção: Data de ativação
  const [dataCorte, setDataCorte] = useState<string>("");
  const [savingDataCorte, setSavingDataCorte] = useState(false);

  // Seção: Modelos de contrato permitidos
  const [modelos, setModelos] = useState<ModeloContrato[]>([]);
  const [modelosPermitidos, setModelosPermitidos] = useState<string[]>([]);

  // Kill switch da integração
  const [pausada, setPausada] = useState(false);
  const [confirmPauseOpen, setConfirmPauseOpen] = useState(false);
  const [savingPausa, setSavingPausa] = useState(false);

  // Seção: números extras que recebem os alertas de WhatsApp do OMIE
  const [alertNumbers, setAlertNumbers] = useState<string[]>([]);
  const [novoNumero, setNovoNumero] = useState("");
  const [savingNumeros, setSavingNumeros] = useState(false);

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tid]);

  async function carregar() {
    setLoading(true);
    setErro(null);
    try {
      const { data, error } = await supabase.functions.invoke("omie-integration-call", {
        body: { acao: "ler_padroes", tenant_id: tid, dados: { operacao: "ler" } },
      });
      if (error) throw error;
      const res = (data?.resultado ?? data) as LerResp;
      if (!res?.ok) throw new Error(res?.error || "Falha ao carregar padrões.");

      const _contas = res.contas ?? [];
      const _servicos = res.servicos ?? [];
      const _tiposFat = res.tipos_faturamento ?? [];
      const _tiposVenc = res.tipos_vencimento ?? [];
      setContas(_contas);
      setServicos(_servicos);
      setTiposFaturamento(_tiposFat);
      setTiposVencimento(_tiposVenc);

      const p = res.padroes ?? {};

      // Conta corrente
      let cc = p.conta_corrente_codigo ? String(p.conta_corrente_codigo) : "";
      if (!cc && p.conta_corrente) {
        const match = _contas.find((c) => c.descricao === p.conta_corrente);
        if (match) cc = String(match.codigo);
      }
      setContaCodigo(cc);

      // Servico
      let sv = p.servico_omie_codigo ? String(p.servico_omie_codigo) : "";
      if (!sv && p.servico_descricao) {
        const match = _servicos.find((s) => s.descricao === p.servico_descricao);
        if (match) sv = String(match.codigo);
      }
      setServicoCodigo(sv);

      // Tipo Faturamento
      let tf = p.tipo_faturamento_codigo ? String(p.tipo_faturamento_codigo) : "";
      if (!tf && p.tipo_faturamento) {
        const match = _tiposFat.find((t) => t.descricao === p.tipo_faturamento || String(t.codigo) === p.tipo_faturamento);
        if (match) tf = String(match.codigo);
      }
      if (!tf) tf = "01";
      setTipoFatCodigo(tf);

      setDiaFaturamento(p.dia_faturamento != null ? String(p.dia_faturamento) : "");
      setNumeroParcelas(p.numero_parcelas != null ? String(p.numero_parcelas) : "");
      setTipoVencimento(p.tipo_vencimento ? String(p.tipo_vencimento) : "");
      setDiaVencimento(p.dia_vencimento != null ? String(p.dia_vencimento) : "");
      setPostergarVencimento(!!p.postergar_vencimento);
      setEnviarLinkNfse(!!p.enviar_link_nfse);
      setEnviarBoleto(!!p.enviar_boleto);
      setPostergarFds(!!p.postergar_finais_semana);
      setAddPeriodoRef(!!p.adicionar_periodo_referencia);
      setAddVencParcela(!!p.adicionar_vencimento_parcela);
      setModelosPermitidos(Array.isArray(p.modelos_permitidos) ? p.modelos_permitidos.filter((n): n is string => typeof n === "string") : []);

      // Data de corte + lista de modelos (paralelo)
      const [omieRow, modelosRes] = await Promise.all([
        (supabase.from("omie_integration" as any) as any)
          .select("integrar_a_partir_de, integracao_pausada, alert_whatsapp_numbers")
          .eq("tenant_id", tid)
          .maybeSingle(),
        (supabase.from("modelos_contrato" as any) as any)
          .select("id, nome")
          .eq("tenant_id", tid)
          .order("nome"),
      ]);
      const dc = (omieRow?.data as any)?.integrar_a_partir_de ?? null;
      setDataCorte(dc ? String(dc).slice(0, 10) : "");
      setPausada(!!(omieRow?.data as any)?.integracao_pausada);
      const _nums = (omieRow?.data as any)?.alert_whatsapp_numbers;
      setAlertNumbers(Array.isArray(_nums) ? _nums.map((n: any) => String(n)) : []);
      setModelos(((modelosRes?.data as any[]) ?? []).map((m) => ({ id: String(m.id), nome: String(m.nome) })));
    } catch (err: any) {
      setErro(err?.message || "Erro ao carregar padrões.");
    } finally {
      setLoading(false);
    }
  }

  const contaSel = useMemo(() => contas.find((c) => String(c.codigo) === contaCodigo), [contas, contaCodigo]);
  const servicoSel = useMemo(() => servicos.find((s) => String(s.codigo) === servicoCodigo), [servicos, servicoCodigo]);
  const tipoFatSel = useMemo(() => tiposFaturamento.find((t) => String(t.codigo) === tipoFatCodigo), [tiposFaturamento, tipoFatCodigo]);

  function validarDia(val: string): number | null {
    if (val === "") return null;
    const n = Number(val);
    if (!Number.isInteger(n) || n < 1 || n > 31) return NaN as any;
    return n;
  }

  async function salvar() {
    const diaFat = validarDia(diaFaturamento);
    if (Number.isNaN(diaFat as any)) {
      toast({ title: "Dia de faturamento inválido", description: "Informe um valor entre 1 e 31.", variant: "destructive" });
      return;
    }
    const diaVenc = validarDia(diaVencimento);
    if (Number.isNaN(diaVenc as any)) {
      toast({ title: "Dia de vencimento inválido", description: "Informe um valor entre 1 e 31.", variant: "destructive" });
      return;
    }
    const nParc = numeroParcelas === "" ? null : Number(numeroParcelas);
    if (nParc !== null && (!Number.isInteger(nParc) || nParc < 1)) {
      toast({ title: "Número de parcelas inválido", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const padroes = {
        conta_corrente_codigo: contaCodigo || null,
        conta_corrente_nome: contaSel?.descricao ?? null,
        servico_omie_codigo: servicoCodigo || null,
        servico_descricao: servicoSel?.descricao ?? null,
        servico_lc116: servicoSel?.cod_lc116 ?? null,
        tipo_faturamento_codigo: tipoFatCodigo || null,
        tipo_faturamento_nome: tipoFatSel?.descricao ?? null,
        dia_faturamento: diaFat,
        numero_parcelas: nParc,
        tipo_vencimento: tipoVencimento || null,
        dia_vencimento: diaVenc,
        postergar_vencimento: postergarVencimento,
        enviar_link_nfse: enviarLinkNfse,
        enviar_boleto: enviarBoleto,
        postergar_finais_semana: postergarFds,
        adicionar_periodo_referencia: addPeriodoRef,
        adicionar_vencimento_parcela: addVencParcela,
        modelos_permitidos: modelosPermitidos,
      };

      const { data, error } = await supabase.functions.invoke("omie-integration-call", {
        body: { acao: "salvar_padroes", tenant_id: tid, dados: { operacao: "salvar", padroes } },
      });
      if (error) throw error;
      const res = (data?.resultado ?? data) as { ok: boolean; error?: string };
      if (!res?.ok) throw new Error(res?.error || "Não foi possível salvar.");
      toast({ title: "Padrões salvos" });
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function salvarDataCorte() {
    setSavingDataCorte(true);
    try {
      const { error } = await (supabase as any).rpc("salvar_data_corte_omie", {
        p_tenant_id: tid,
        p_data: dataCorte || null,
      });
      if (error) throw error;
      toast({ title: "Data de ativação salva" });
    } catch (err: any) {
      toast({ title: "Erro ao salvar data", description: err?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setSavingDataCorte(false);
    }
  }

  function toggleModelo(nome: string, checked: boolean) {
    setModelosPermitidos((prev) => {
      const set = new Set(prev);
      if (checked) set.add(nome);
      else set.delete(nome);
      return Array.from(set);
    });
  }

  async function aplicarPausa(novaPausa: boolean) {
    setSavingPausa(true);
    try {
      const { error } = await (supabase.from("omie_integration" as any) as any)
        .update({ integracao_pausada: novaPausa })
        .eq("tenant_id", tid);
      if (error) throw error;
      setPausada(novaPausa);
      toast({ title: novaPausa ? "Integração pausada" : "Integração reativada" });
    } catch (err: any) {
      toast({ title: "Erro ao atualizar", description: err?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setSavingPausa(false);
      setConfirmPauseOpen(false);
    }
  }

  function onToggleKillSwitch(checked: boolean) {
    // checked = true → ativa (pausada=false); checked = false → desligar (pausar)
    if (!checked) {
      setConfirmPauseOpen(true);
    } else {
      void aplicarPausa(false);
    }
  }

  function adicionarNumero() {
    const n = novoNumero.replace(/\D/g, "");
    if (n.length < 10 || n.length > 13) {
      toast({ title: "Número inválido", description: "Use DDD + número (ex: 5531999998888).", variant: "destructive" });
      return;
    }
    setAlertNumbers((prev) => (prev.includes(n) ? prev : [...prev, n]));
    setNovoNumero("");
  }

  function removerNumero(n: string) {
    setAlertNumbers((prev) => prev.filter((x) => x !== n));
  }

  async function salvarNumeros() {
    setSavingNumeros(true);
    try {
      const { error } = await (supabase.from("omie_integration" as any) as any)
        .update({ alert_whatsapp_numbers: alertNumbers })
        .eq("tenant_id", tid);
      if (error) throw error;
      toast({ title: "Números salvos" });
    } catch (err: any) {
      toast({ title: "Erro ao salvar números", description: err?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setSavingNumeros(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 max-w-3xl">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (erro) {
    return (
      <Card className="max-w-3xl">
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-start gap-2 text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5" />
            <span className="text-sm">{erro}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => void carregar()}>Tentar novamente</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {pausada && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-4 py-3 flex items-center gap-2">
          <Pause className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">
            ⏸️ Integração Omie pausada — nada está sendo enviado ao Omie.
          </span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Status da integração</CardTitle>
          <CardDescription>
            Kill switch geral. Enquanto pausada, nenhuma alteração vai para o Omie (nem a sincronização automática,
            nem o botão "Enviar ao Omie"). A conferência e o vínculo manual continuam liberados.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="flex items-center gap-2 min-w-0">
              <Label className="text-sm">Integração Omie ativa</Label>
              {!pausada && (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  Integração ativa
                </span>
              )}
            </div>
            <Switch
              checked={!pausada}
              onCheckedChange={onToggleKillSwitch}
              disabled={savingPausa}
            />
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmPauseOpen} onOpenChange={(o) => { if (!savingPausa) setConfirmPauseOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pausar a integração Omie?</AlertDialogTitle>
            <AlertDialogDescription>
              Enquanto pausada, NENHUMA alteração vai para o Omie — nem a sincronização automática, nem o botão "Enviar ao Omie".
              As movimentações que acontecerem enquanto estiver pausada são descartadas (a fila não acumula).
              Ao reativar, só sincroniza o que vier a partir daí. O trabalho de conciliação (Conferência/vincular) continua liberado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingPausa}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void aplicarPausa(true); }}
              disabled={savingPausa}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {savingPausa && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Pausar integração
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <p className="text-sm text-muted-foreground">
        Estes são os valores padrão usados ao enviar contratos ao Omie. Se um produto tiver o campo preenchido,
        o valor do produto tem prioridade; caso contrário, usa-se o padrão definido aqui.
      </p>


      <Card>
        <CardHeader>
          <CardTitle>Padrões de Contrato</CardTitle>
          <CardDescription>Conta, serviço e faturamento padrão.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Conta Corrente</Label>
            <Select value={contaCodigo} onValueChange={setContaCodigo}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {contas.map((c) => (
                  <SelectItem key={String(c.codigo)} value={String(c.codigo)}>{c.descricao}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Serviço Padrão</Label>
            <Select value={servicoCodigo} onValueChange={setServicoCodigo}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {servicos.map((s) => (
                  <SelectItem key={String(s.codigo)} value={String(s.codigo)}>{s.descricao}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Tipo de Faturamento</Label>
              <Select value={tipoFatCodigo} onValueChange={setTipoFatCodigo}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {tiposFaturamento.map((t) => (
                    <SelectItem key={String(t.codigo)} value={String(t.codigo)}>{t.descricao}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Dia de Faturamento</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={diaFaturamento}
                onChange={(e) => setDiaFaturamento(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Número de Parcelas</Label>
              <Input
                type="number"
                min={1}
                value={numeroParcelas}
                onChange={(e) => setNumeroParcelas(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vencimento (padrão)</CardTitle>
          <CardDescription>
            Usado apenas quando o cliente não tiver dia de vencimento próprio. O dia de vencimento do
            cadastro do cliente sempre tem prioridade.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tipo de Vencimento</Label>
              <Select value={tipoVencimento} onValueChange={setTipoVencimento}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {tiposVencimento.map((t) => (
                    <SelectItem key={String(t.codigo)} value={String(t.codigo)}>{t.descricao}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Dia de Vencimento</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={diaVencimento}
                onChange={(e) => setDiaVencimento(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label className="text-sm">Postergar para o próximo dia útil</Label>
            </div>
            <Switch checked={postergarVencimento} onCheckedChange={setPostergarVencimento} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>NFS-e e Cobrança</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { label: "Enviar link da NFS-e", val: enviarLinkNfse, set: setEnviarLinkNfse },
            { label: "Enviar boleto", val: enviarBoleto, set: setEnviarBoleto },
            { label: "Postergar finais de semana", val: postergarFds, set: setPostergarFds },
            { label: "Adicionar período de referência", val: addPeriodoRef, set: setAddPeriodoRef },
            { label: "Adicionar vencimento da parcela", val: addVencParcela, set: setAddVencParcela },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between rounded-md border p-3">
              <Label className="text-sm">{item.label}</Label>
              <Switch checked={item.val} onCheckedChange={item.set} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data de ativação da integração</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>Integrar contratos criados a partir de</Label>
            <Input
              type="date"
              value={dataCorte}
              onChange={(e) => setDataCorte(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Somente contratos criados a partir desta data poderão ser enviados ao Omie. Contratos anteriores não são afetados. Deixe em branco para manter a integração desligada.
            </p>
          </div>
          <div className="flex justify-end">
            <Button variant="outline" onClick={salvarDataCorte} disabled={savingDataCorte}>
              {savingDataCorte ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar data de ativação
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Números para alertas de WhatsApp (OMIE)</CardTitle>
          <CardDescription>
            Quem recebe no WhatsApp os avisos da integração OMIE (cancelamento que não propagou, vínculo ambíguo).
            Estes números recebem <strong>além</strong> dos usuários já inscritos. O envio sai da instância de alertas do próprio tenant.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Ex: 5531999998888 (DDD + número)"
              value={novoNumero}
              inputMode="numeric"
              onChange={(e) => setNovoNumero(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionarNumero(); } }}
            />
            <Button type="button" variant="outline" onClick={adicionarNumero}>Adicionar</Button>
          </div>
          {alertNumbers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum número extra. Só os usuários inscritos recebem por WhatsApp.</p>
          ) : (
            <div className="space-y-2">
              {alertNumbers.map((n) => (
                <div key={n} className="flex items-center justify-between rounded-md border p-2">
                  <span className="text-sm font-mono">{n}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => removerNumero(n)}>Remover</Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <Button variant="outline" onClick={salvarNumeros} disabled={savingNumeros}>
              {savingNumeros ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar números
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Modelos de contrato permitidos</CardTitle>
          <CardDescription>
            Selecione quais modelos de contrato podem ser enviados ao Omie. Se nenhum for selecionado, nenhum contrato será enviado.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {modelos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum modelo de contrato cadastrado.</p>
          ) : (
            modelos.map((m) => {
              const checked = modelosPermitidos.includes(m.nome);
              return (
                <div key={m.id} className="flex items-center gap-2 rounded-md border p-3">
                  <Checkbox
                    id={`modelo-${m.id}`}
                    checked={checked}
                    onCheckedChange={(v) => toggleModelo(m.nome, v === true)}
                  />
                  <Label htmlFor={`modelo-${m.id}`} className="text-sm font-normal cursor-pointer">
                    {m.nome}
                  </Label>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>


      <div className="flex justify-end">
        <Button onClick={salvar} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar padrões
        </Button>
      </div>
    </div>
  );
}
