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
import { Loader2, Save, AlertCircle } from "lucide-react";

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
};

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

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function carregar() {
    setLoading(true);
    setErro(null);
    try {
      const { data, error } = await supabase.functions.invoke("omie-integration-call", {
        body: { acao: "ler_padroes", dados: { operacao: "ler" } },
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
      };

      const { data, error } = await supabase.functions.invoke("omie-integration-call", {
        body: { acao: "salvar_padroes", dados: { operacao: "salvar", padroes } },
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

      <div className="flex justify-end">
        <Button onClick={salvar} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar padrões
        </Button>
      </div>
    </div>
  );
}
