import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Plus, XCircle, TrendingUp, TrendingDown, ArrowUpDown, AlertCircle, DollarSign, Lock, Rocket } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface MovimentoMrr {
  id: string;
  cliente_id: string;
  tipo: 'upsell' | 'cross_sell' | 'downsell' | 'venda_avulsa' | 'reajuste';
  data_movimento: string;
  valor_delta: number;
  custo_delta: number;
  valor_venda_avulsa: number | null;
  origem_venda: string | null;
  descricao: string | null;
  funcionario_id: number | null;
  estorno_de: string | null;
  estornado_por: string | null;
  criado_em: string;
  status: string;
  inativado_em: string | null;
  inativado_por_id: number | null;
  // Taxa de setup lançada junto do movimento. Cobrança única: não entra no MRR
  // e conta como faturamento no mês da `data_movimento`.
  vlr_ativacao: number | null;
  // Preenchido quando o movimento nasceu de um módulo da ficha do cliente —
  // upsell na adição, downsell no cancelamento. É o que trava o desativar.
  cliente_produto_modulo_id: string | null;
}

// Movimento que acompanha um módulo não se desfaz por aqui: quem manda é a
// ficha. Desativar o upsell deixaria de contar uma receita que o cliente
// continua pagando; desativar o downsell devolveria ao MRR um valor que ele
// deixou de pagar — nos dois casos o número passa a divergir do que o cliente
// tem contratado, e nada na ficha diz que isso aconteceu.
const motivoDoModulo = (tipo: string) =>
  tipo === 'downsell'
    ? 'Este movimento nasceu do cancelamento de um módulo, na aba Produtos do cliente. Ele acompanha o módulo: desativá-lo aqui devolveria ao MRR um valor que o cliente não paga mais. Se o cancelamento foi engano, resolva pelo módulo, na ficha.'
    : 'Este movimento nasceu da adição de um módulo, na aba Produtos do cliente. Ele acompanha o módulo: desativá-lo aqui tiraria do MRR uma receita que o cliente continua pagando. Para desfazer a venda, cancele o módulo na ficha — o downsell entra sozinho.';

// Ativação é taxa de setup de venda nova. Downsell é redução de receita e Venda
// Avulsa já É um valor único — nos dois o campo não teria o que significar.
const TIPOS_COM_ATIVACAO = new Set(['upsell', 'cross_sell']);

interface MovimentosMrrModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clienteId: string;
  tenantId?: string | null;
  clienteNome: string;
  mensalidadeBase: number;
  custoBase: number;
  funcionarios: { id: number; nome: string }[];
}

interface OrigemOption { id: number; nome: string }

function OrigemCombobox({
  value,
  onChange,
  origens,
  loading,
}: {
  value: string;
  onChange: (v: string) => void;
  origens: OrigemOption[];
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const sorted = useMemo(
    () => [...origens].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })),
    [origens]
  );
  const matchInCatalog = useMemo(
    () => sorted.find((o) => o.nome.localeCompare(value, 'pt-BR', { sensitivity: 'base' }) === 0),
    [sorted, value]
  );
  const isLegacy = !!value && !matchInCatalog;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !value && "text-muted-foreground", isLegacy && "italic")}>
            {value
              ? (isLegacy ? `${value} (valor antigo)` : matchInCatalog!.nome)
              : (loading ? 'Carregando…' : 'Selecione a origem')}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          filter={(val, search) =>
            val.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(
              search.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            ) ? 1 : 0
          }
        >
          <CommandInput placeholder="Buscar origem..." />
          <CommandList className="max-h-[260px]">
            <CommandEmpty>Nenhuma origem encontrada.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__sem_origem__"
                onSelect={() => { onChange(''); setOpen(false); }}
              >
                <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                <span className="text-muted-foreground">— Sem origem —</span>
              </CommandItem>
              {sorted.map((o) => (
                <CommandItem
                  key={o.id}
                  value={o.nome}
                  onSelect={() => { onChange(o.nome); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", matchInCatalog?.id === o.id ? "opacity-100" : "opacity-0")} />
                  {o.nome}
                </CommandItem>
              ))}
              {isLegacy && (
                <CommandItem value={value} onSelect={() => setOpen(false)}>
                  <Check className="mr-2 h-4 w-4 opacity-100" />
                  <span className="italic">{value} (valor antigo)</span>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const TIPO_LABELS: Record<string, { label: string; color: string }> = {
  upsell: { label: 'Upsell', color: 'bg-green-500' },
  cross_sell: { label: 'Cross-sell', color: 'bg-blue-500' },
  downsell: { label: 'Downsell', color: 'bg-orange-500' },
  venda_avulsa: { label: 'Venda Avulsa', color: 'bg-purple-500' },
};

export function MovimentosMrrModal({
  open,
  onOpenChange,
  clienteId,
  tenantId,
  clienteNome,
  mensalidadeBase,
  custoBase,
  funcionarios,
}: MovimentosMrrModalProps) {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const draftKey = `draft:mov_mrr:${profile?.tenant_id ?? "t"}:${user?.id ?? "u"}:new:${clienteId}`;

  const { data: origensCatalogo = [], isLoading: loadingOrigens } = useQuery<OrigemOption[]>({
    queryKey: ['origens_venda_catalog', profile?.tenant_id],
    enabled: !!profile?.tenant_id && open,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      let q = supabase.from('origens_venda').select('id, nome');
      if (profile?.tenant_id) q = q.eq('tenant_id', profile.tenant_id);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as OrigemOption[];
    },
  });

  const setOrigemVendaDirty = useCallback((v: string) => {
    setOrigemVenda(v);
    formIsDirty.current = true;
  }, []);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [movimentos, setMovimentos] = useState<MovimentoMrr[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);

  // Form state
  const [tipo, setTipo] = useState<'upsell' | 'cross_sell' | 'downsell' | 'venda_avulsa'>('upsell');
  const [dataMovimento, setDataMovimento] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [valorDelta, setValorDelta] = useState('');
  const [custoDelta, setCustoDelta] = useState('');
  const [valorVendaAvulsa, setValorVendaAvulsa] = useState('');
  const [valorAtivacao, setValorAtivacao] = useState('');
  const [origemVenda, setOrigemVenda] = useState('');
  const [descricao, setDescricao] = useState('');
  const [funcionarioId, setFuncionarioId] = useState<string>('');

  // Draft state
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [showDraftPrompt, setShowDraftPrompt] = useState(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formIsDirty = useRef(false);

  const [deactivateConfirm, setDeactivateConfirm] = useState<{ open: boolean; movimento: MovimentoMrr | null }>({
    open: false,
    movimento: null,
  });

  const fetchMovimentos = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('movimentos_mrr')
        .select('*')
        .eq('cliente_id', clienteId)
        .order('data_movimento', { ascending: false });

      if (error) throw error;
      setMovimentos((data as unknown as MovimentoMrr[]) || []);
      // Invalidate downstream caches (MRR Atual em FinanceiroCard, financeiro tab, cliente header)
      qc.invalidateQueries({ queryKey: ['movimentos_mrr_totals', clienteId] });
      qc.invalidateQueries({ queryKey: ['cliente', clienteId] });
      qc.invalidateQueries({ queryKey: ['cliente_produtos_ativacao', clienteId] });
      // Listagem de clientes (MRR Atual/Ticket Médio na tela /clientes)
      qc.invalidateQueries({ queryKey: ['clientes_lista'] });
      qc.invalidateQueries({ queryKey: ['clientes_ticket_medio'] });
      qc.invalidateQueries({ queryKey: ['movimentos_mrr_deltas_lista'] });
    } catch (error) {
      console.error('Error fetching movimentos:', error);
      toast.error('Erro ao carregar movimentos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && clienteId) {
      fetchMovimentos();
      // Check for existing draft
      try {
        const raw = localStorage.getItem(draftKey);
        if (raw) {
          setShowDraftPrompt(true);
          setShowAddForm(true);
        }
      } catch { /* ignore */ }
    }
  }, [open, clienteId]);

  // Protect against accidental refresh while add form is open
  useEffect(() => {
    if (!showAddForm || !open) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [showAddForm, open]);

  // Debounce-save draft while add form is open and dirty
  const formSnapshot = JSON.stringify({ tipo, dataMovimento, valorDelta, custoDelta, valorVendaAvulsa, valorAtivacao, origemVenda, descricao, funcionarioId });
  useEffect(() => {
    if (!open || !showAddForm || !formIsDirty.current) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    setDraftStatus("saving");
    draftTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, formSnapshot);
        setDraftStatus("saved");
      } catch {
        setDraftStatus("idle");
      }
    }, 600);
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [formSnapshot, open, showAddForm, draftKey]);

  const restoreDraft = useCallback(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.tipo) setTipo(d.tipo);
        if (d.dataMovimento) setDataMovimento(d.dataMovimento);
        if (d.valorDelta !== undefined) setValorDelta(d.valorDelta);
        if (d.custoDelta !== undefined) setCustoDelta(d.custoDelta);
        if (d.valorVendaAvulsa !== undefined) setValorVendaAvulsa(d.valorVendaAvulsa);
        if (d.valorAtivacao !== undefined) setValorAtivacao(d.valorAtivacao);
        if (d.origemVenda !== undefined) setOrigemVenda(d.origemVenda);
        if (d.descricao !== undefined) setDescricao(d.descricao);
        if (d.funcionarioId !== undefined) setFuncionarioId(d.funcionarioId);
        formIsDirty.current = true;
      }
    } catch { /* ignore */ }
    setShowDraftPrompt(false);
  }, [draftKey]);

  const dismissDraft = useCallback(() => {
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    setShowDraftPrompt(false);
    formIsDirty.current = false;
  }, [draftKey]);

  const clearDraft = useCallback(() => {
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    setDraftStatus("idle");
    formIsDirty.current = false;
  }, [draftKey]);

  // Mark dirty on any field change (wrapper)
  const setField = useCallback(<T,>(setter: React.Dispatch<React.SetStateAction<T>>, value: T) => {
    setter(value);
    formIsDirty.current = true;
  }, []);

  // Calculations
  const movimentosAtivos = movimentos.filter(m => m.status === 'ativo' && !m.estornado_por && !m.estorno_de && m.tipo !== 'venda_avulsa');
  const vendasAvulsasAtivas = movimentos.filter(m => m.status === 'ativo' && m.tipo === 'venda_avulsa');

  const somaMovimentosAtivos = movimentosAtivos.filter(m => m.tipo !== 'reajuste').reduce((sum, m) => sum + m.valor_delta, 0);
  const totalVendasAvulsas = vendasAvulsasAtivas.reduce((sum, m) => sum + (m.valor_venda_avulsa || 0), 0);
  const somaCustoMovimentos = movimentosAtivos.filter(m => m.tipo !== 'reajuste').reduce((sum, m) => sum + (m.custo_delta || 0), 0);
  const totalReajuste = movimentosAtivos.filter(m => m.tipo === 'reajuste').reduce((sum, m) => sum + m.valor_delta, 0);

  const mrrAjustado = mensalidadeBase + somaMovimentosAtivos;
  const custoAjustado = custoBase + somaCustoMovimentos;

  const upsellItems = movimentosAtivos.filter(m => m.tipo === 'upsell');
  const crossSellItems = movimentosAtivos.filter(m => m.tipo === 'cross_sell');
  const downsellItems = movimentosAtivos.filter(m => m.tipo === 'downsell');
  const reajusteItems = movimentosAtivos.filter(m => m.tipo === 'reajuste');

  const totalUpsell = upsellItems.reduce((sum, m) => sum + m.valor_delta, 0);
  const totalCrossSell = crossSellItems.reduce((sum, m) => sum + m.valor_delta, 0);
  const totalDownsell = downsellItems.reduce((sum, m) => sum + Math.abs(m.valor_delta), 0);

  const qtdUpsell = upsellItems.length;
  const qtdCrossSell = crossSellItems.length;
  const qtdDownsell = downsellItems.length;
  const qtdReajuste = reajusteItems.length;
  const qtdVendasAvulsas = vendasAvulsasAtivas.length;

  const totalCustoUpsell = upsellItems.reduce((sum, m) => sum + (m.custo_delta || 0), 0);
  const totalCustoCrossSell = crossSellItems.reduce((sum, m) => sum + (m.custo_delta || 0), 0);
  const totalCustoDownsell = downsellItems.reduce((sum, m) => sum + Math.abs(m.custo_delta || 0), 0);

  // Ativação lançada nos movimentos — cobrança única. Fica fora de mrrAjustado e
  // de qualquer total acima: nenhuma linha do MRR a enxerga.
  // Movimento inativado ou estornado é lançamento DESFEITO, então a ativação dele
  // sai junto. (Regra diferente da do módulo cancelado, onde a cobrança já tinha
  // acontecido de verdade e por isso continua somando.)
  const movimentosComAtivacao = movimentos.filter(
    (m) => m.status === 'ativo' && !m.estornado_por && !m.estorno_de && Number(m.vlr_ativacao) > 0
  );
  const totalAtivacao = movimentosComAtivacao.reduce((sum, m) => sum + (Number(m.vlr_ativacao) || 0), 0);
  const qtdAtivacao = movimentosComAtivacao.length;

  const getFuncionarioNome = (id: number | null) => {
    if (!id) return '-';
    return funcionarios.find(f => f.id === id)?.nome || '-';
  };

  const resetForm = () => {
    setTipo('upsell');
    setDataMovimento(format(new Date(), 'yyyy-MM-dd'));
    setValorDelta('');
    setCustoDelta('');
    setValorVendaAvulsa('');
    setValorAtivacao('');
    setOrigemVenda('');
    setDescricao('');
    setFuncionarioId('');
    setShowAddForm(false);
    formIsDirty.current = false;
    setDraftStatus("idle");
    setShowDraftPrompt(false);
  };

  const handleSubmit = async () => {
    if (!funcionarioId) {
      toast.error('Selecione o funcionário responsável');
      return;
    }

    if (tipo === 'venda_avulsa') {
      if (!valorVendaAvulsa || parseFloat(valorVendaAvulsa) <= 0) {
        toast.error('O valor da venda avulsa deve ser maior que zero');
        return;
      }
    } else {
      if (!valorDelta || parseFloat(valorDelta) === 0) {
        toast.error('O valor não pode ser zero');
        return;
      }
    }

    if (!dataMovimento) {
      toast.error('A data do movimento é obrigatória');
      return;
    }

    setSaving(true);
    try {
      let insertData: any = {
        tenant_id: tenantId ?? profile?.tenant_id ?? null,
        cliente_id: clienteId,
        tipo,
        data_movimento: dataMovimento,
        origem_venda: origemVenda || null,
        descricao: descricao || null,
        funcionario_id: parseInt(funcionarioId),
      };

      if (tipo === 'venda_avulsa') {
        insertData.valor_delta = 0;
        insertData.custo_delta = 0;
        insertData.valor_venda_avulsa = parseFloat(valorVendaAvulsa);
      } else {
        let valor = Math.abs(parseFloat(valorDelta));
        let custo = Math.abs(parseFloat(custoDelta) || 0);
        if (tipo === 'downsell') {
          valor = -valor;
          custo = -custo;
        }
        insertData.valor_delta = valor;
        insertData.custo_delta = custo;
      }

      // Cobrança única, à parte do valor_delta. Só upsell/cross-sell têm o campo;
      // nos demais o zero explícito impede que um rascunho antigo vaze o valor.
      insertData.vlr_ativacao = TIPOS_COM_ATIVACAO.has(tipo)
        ? Math.abs(parseFloat(valorAtivacao) || 0)
        : 0;

      const { error } = await supabase
        .from('movimentos_mrr')
        .insert(insertData);

      if (error) throw error;

      toast.success('Movimento registrado com sucesso');
      clearDraft();
      resetForm();
      fetchMovimentos();
    } catch (error: any) {
      console.error('Error creating movimento:', error);
      toast.error(`Erro ao registrar movimento: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivateClick = (movimento: MovimentoMrr) => {
    if (movimento.status === 'inativo') return;
    if (movimento.estornado_por) return;
    if (movimento.estorno_de) return;
    // O cadeado já esconde o botão; isto é para o caminho que ninguém previu.
    if (movimento.cliente_produto_modulo_id) {
      toast.info(motivoDoModulo(movimento.tipo));
      return;
    }
    setDeactivateConfirm({ open: true, movimento });
  };

  const handleConfirmDeactivate = async () => {
    const movimento = deactivateConfirm.movimento;
    if (!movimento) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('movimentos_mrr')
        .update({
          status: 'inativo',
          inativado_em: new Date().toISOString(),
        } as any)
        .eq('id', movimento.id);

      if (error) throw error;

      toast.success('Movimento inativado com sucesso');
      setDeactivateConfirm({ open: false, movimento: null });
      fetchMovimentos();
    } catch (error) {
      console.error('Error deactivating movimento:', error);
      toast.error('Erro ao inativar movimento');
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowUpDown className="h-5 w-5" />
              Movimentos de MRR
            </DialogTitle>
            <DialogDescription>{clienteNome}</DialogDescription>
          </DialogHeader>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-4">
            <Card>
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-xs font-medium text-muted-foreground">MRR Base</CardTitle>
              </CardHeader>
              <CardContent className="py-1 px-3">
                <p className="text-lg font-bold">{formatCurrency(mensalidadeBase)}</p>
                <p className="text-xs text-muted-foreground">Custo: {formatCurrency(custoBase)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-3 w-3 text-green-600" /> Upsell
                </CardTitle>
              </CardHeader>
              <CardContent className="py-1 px-3">
                <p className="text-lg font-bold text-green-600">+{formatCurrency(totalUpsell)}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">{qtdUpsell} {qtdUpsell === 1 ? 'movimento' : 'movimentos'}</p>
                <p className="text-xs text-muted-foreground">Custo: +{formatCurrency(totalCustoUpsell)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-3 w-3 text-blue-600" /> Cross-sell
                </CardTitle>
              </CardHeader>
              <CardContent className="py-1 px-3">
                <p className="text-lg font-bold text-blue-600">+{formatCurrency(totalCrossSell)}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">{qtdCrossSell} {qtdCrossSell === 1 ? 'movimento' : 'movimentos'}</p>
                <p className="text-xs text-muted-foreground">Custo: +{formatCurrency(totalCustoCrossSell)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <TrendingDown className="h-3 w-3 text-orange-600" /> Downsell
                </CardTitle>
              </CardHeader>
              <CardContent className="py-1 px-3">
                <p className="text-lg font-bold text-orange-600">-{formatCurrency(totalDownsell)}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">{qtdDownsell} {qtdDownsell === 1 ? 'movimento' : 'movimentos'}</p>
                <p className="text-xs text-muted-foreground">Custo: -{formatCurrency(totalCustoDownsell)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <DollarSign className="h-3 w-3 text-purple-600" /> V. Avulsas
                </CardTitle>
              </CardHeader>
              <CardContent className="py-1 px-3">
                <p className="text-lg font-bold text-purple-600">{formatCurrency(totalVendasAvulsas)}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">{qtdVendasAvulsas} {qtdVendasAvulsas === 1 ? 'movimento' : 'movimentos'}</p>
                <p className="text-xs text-muted-foreground">Não afeta MRR</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Rocket className="h-3 w-3 text-amber-500" /> Ativação
                </CardTitle>
              </CardHeader>
              <CardContent className="py-1 px-3">
                <p className="text-lg font-bold text-amber-500">{formatCurrency(totalAtivacao)}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">{qtdAtivacao} {qtdAtivacao === 1 ? 'movimento' : 'movimentos'}</p>
                <p className="text-muted-foreground text-[9px]">Não afeta MRR</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-3 w-3 text-cyan-500" /> Reajuste
                </CardTitle>
              </CardHeader>
              <CardContent className="py-1 px-3">
                <p className="text-lg font-bold text-cyan-500">+{formatCurrency(totalReajuste)}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">{qtdReajuste} {qtdReajuste === 1 ? 'movimento' : 'movimentos'}</p>
                <p className="text-muted-foreground text-[9px]">Não afeta MRR</p>
              </CardContent>
            </Card>
            <Card className="bg-primary/5 border-primary/20">
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-xs font-medium text-muted-foreground">MRR Atual</CardTitle>
              </CardHeader>
              <CardContent className="py-1 px-3">
                <p className="text-lg font-bold text-primary">{formatCurrency(mrrAjustado)}</p>
                <p className="text-xs text-muted-foreground">Custo: {formatCurrency(custoAjustado)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Composition Card */}
          <Card className="mb-4 bg-muted/30">
            <CardContent className="py-3 px-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Composição MRR</p>
                  <p className="text-sm">
                    <span className="font-medium">Base:</span> {formatCurrency(mensalidadeBase)}
                    <span className="mx-1">+</span>
                    <span className={somaMovimentosAtivos >= 0 ? "text-green-600" : "text-red-600"}>
                      {somaMovimentosAtivos >= 0 ? '+' : ''}{formatCurrency(somaMovimentosAtivos)}
                    </span>
                    <span className="mx-1">=</span>
                    <span className="font-bold text-primary">{formatCurrency(mrrAjustado)}</span>
                  </p>
                  {totalReajuste !== 0 && (
                    <p className="text-xs mt-1">
                      <span className="text-cyan-500">+ Reajuste: +{formatCurrency(totalReajuste)}</span>
                      <span className="text-muted-foreground ml-1">(já incluso no base)</span>
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Composição Custo</p>
                  <p className="text-sm">
                    <span className="font-medium">Base:</span> {formatCurrency(custoBase)}
                    <span className="mx-1">+</span>
                    <span className={somaCustoMovimentos >= 0 ? "text-green-600" : "text-red-600"}>
                      {somaCustoMovimentos >= 0 ? '+' : ''}{formatCurrency(somaCustoMovimentos)}
                    </span>
                    <span className="mx-1">=</span>
                    <span className="font-bold">{formatCurrency(custoAjustado)}</span>
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Add Button */}
          {!showAddForm && (
            <Button onClick={() => setShowAddForm(true)} className="w-full mb-4">
              <Plus className="h-4 w-4 mr-2" />
              Adicionar Movimento
            </Button>
          )}

          {/* Add Form */}
          {showAddForm && (
            <Card className="mb-4">
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Novo Movimento</CardTitle>
                  {draftStatus === "saved" && formIsDirty.current && (
                    <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600 border-green-500/30">
                      Rascunho salvo
                    </Badge>
                  )}
                  {draftStatus === "saving" && (
                    <Badge variant="outline" className="text-xs bg-muted text-muted-foreground">
                      Salvando…
                    </Badge>
                  )}
                </div>
              </CardHeader>
              {showDraftPrompt ? (
                <CardContent className="space-y-4">
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
                    <p className="font-medium text-amber-700 dark:text-amber-400">Rascunho não salvo encontrado.</p>
                    <p className="text-muted-foreground mt-1">Deseja restaurar os dados preenchidos anteriormente?</p>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={dismissDraft}>Descartar</Button>
                    <Button size="sm" onClick={restoreDraft}>Restaurar</Button>
                  </div>
                </CardContent>
              ) : (
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Tipo *</Label>
                    <Select value={tipo} onValueChange={(v: any) => { setTipo(v); formIsDirty.current = true; }}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="upsell">
                          <div className="flex items-center gap-2">
                            <TrendingUp className="h-4 w-4 text-green-500" /> Upsell (aumento MRR)
                          </div>
                        </SelectItem>
                        <SelectItem value="cross_sell">
                          <div className="flex items-center gap-2">
                            <TrendingUp className="h-4 w-4 text-blue-500" /> Cross-sell (novo produto)
                          </div>
                        </SelectItem>
                        <SelectItem value="downsell">
                          <div className="flex items-center gap-2">
                            <TrendingDown className="h-4 w-4 text-orange-500" /> Downsell (redução MRR)
                          </div>
                        </SelectItem>
                        <SelectItem value="venda_avulsa">
                          <div className="flex items-center gap-2">
                            <DollarSign className="h-4 w-4 text-purple-500" /> Venda Avulsa (não altera MRR)
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Data *</Label>
                    <Input type="date" value={dataMovimento} onChange={(e) => { setDataMovimento(e.target.value); formIsDirty.current = true; }} />
                  </div>
                </div>

                {/* Funcionário select */}
                <div className="space-y-2">
                  <Label>Funcionário Responsável *</Label>
                  <Select value={funcionarioId} onValueChange={(v) => { setFuncionarioId(v); formIsDirty.current = true; }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o funcionário" />
                    </SelectTrigger>
                    <SelectContent>
                      {funcionarios.map((f) => (
                        <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {tipo === 'venda_avulsa' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Valor da Venda Avulsa (R$) *</Label>
                      <Input type="number" step="0.01" min="0.01" placeholder="Ex: 500.00" value={valorVendaAvulsa} onChange={(e) => { setValorVendaAvulsa(e.target.value); formIsDirty.current = true; }} />
                      <p className="text-xs text-muted-foreground">Este valor será contabilizado na Meta de Ativação (R$) do mês</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Origem</Label>
                      <OrigemCombobox value={origemVenda} onChange={setOrigemVendaDirty} origens={origensCatalogo} loading={loadingOrigens} />
                    </div>
                  </div>
                ) : (
                  <div className={cn(
                    "grid grid-cols-1 gap-4",
                    TIPOS_COM_ATIVACAO.has(tipo) ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"
                  )}>
                    <div className="space-y-2">
                      <Label>Valor MRR (R$) *</Label>
                      <Input type="number" step="0.01" min="0.01" placeholder="Ex: 500.00" value={valorDelta} onChange={(e) => { setValorDelta(e.target.value); formIsDirty.current = true; }} />
                      <p className="text-xs text-muted-foreground">
                        {tipo === 'downsell' ? 'Valor será subtraído do MRR' : 'Valor será somado ao MRR'}
                      </p>
                    </div>
                    {TIPOS_COM_ATIVACAO.has(tipo) && (
                      <div className="space-y-2">
                        <Label>Valor Ativação (R$)</Label>
                        <Input type="number" step="0.01" min="0" placeholder="Ex: 1500.00" value={valorAtivacao} onChange={(e) => { setValorAtivacao(e.target.value); formIsDirty.current = true; }} />
                        <p className="text-xs text-muted-foreground">
                          Cobrança única (setup). Não entra no MRR — vai para o faturamento do mês do movimento.
                        </p>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>Custo (R$)</Label>
                      <Input type="number" step="0.01" min="0" placeholder="Ex: 200.00" value={custoDelta} onChange={(e) => { setCustoDelta(e.target.value); formIsDirty.current = true; }} />
                      <p className="text-xs text-muted-foreground">
                        {tipo === 'downsell' ? 'Custo será subtraído' : 'Custo adicional do movimento'}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>Origem</Label>
                      <OrigemCombobox value={origemVenda} onChange={setOrigemVendaDirty} origens={origensCatalogo} loading={loadingOrigens} />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Descrição</Label>
                  <Textarea placeholder="Detalhes do movimento..." value={descricao} onChange={(e) => { setDescricao(e.target.value); formIsDirty.current = true; }} rows={2} />
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleSubmit} disabled={saving}>
                    {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Salvar
                  </Button>
                  <Button variant="outline" onClick={resetForm}>Cancelar</Button>
                </div>
              </CardContent>
              )}
            </Card>
          )}

          {/* Movements List */}
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : movimentos.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Nenhum movimento registrado</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Funcionário</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movimentos.map((m) => {
                    const isInativo = m.status === 'inativo';
                    const isEstornado = !!m.estornado_por;
                    const isEstorno = !!m.estorno_de;
                    const isVendaAvulsa = m.tipo === 'venda_avulsa';
                    const veioDeModulo = !!m.cliente_produto_modulo_id;
                    const valorExibido = isVendaAvulsa ? (m.valor_venda_avulsa || 0) : m.valor_delta;

                    return (
                      <TableRow key={m.id} className={cn((isInativo || isEstornado) && "opacity-50 bg-muted/30")}>
                        <TableCell className="font-mono text-sm">
                          {format(new Date(m.data_movimento), 'dd/MM/yyyy')}
                        </TableCell>
                        <TableCell>
                          <Badge className={cn("text-white", TIPO_LABELS[m.tipo]?.color)}>
                            {TIPO_LABELS[m.tipo]?.label || m.tipo}
                          </Badge>
                        </TableCell>
                        <TableCell className={cn(
                          "text-right font-mono font-medium",
                          isVendaAvulsa ? "text-purple-600" : valorExibido > 0 ? "text-green-600" : "text-red-600"
                        )}>
                          {isVendaAvulsa ? '' : valorExibido > 0 ? '+' : ''}{formatCurrency(valorExibido)}
                          {Number(m.vlr_ativacao) > 0 && (
                            // Fora do valor, não somado a ele: o MRR da linha continua
                            // sendo só o valor_delta.
                            <span className="block text-[10px] font-normal text-amber-500">
                              Ativação {formatCurrency(Number(m.vlr_ativacao))}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {getFuncionarioNome(m.funcionario_id)}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate" title={m.descricao || ''}>
                          {isEstorno && <span className="text-xs text-muted-foreground">[Estorno] </span>}
                          {m.descricao || '-'}
                        </TableCell>
                        <TableCell>
                          {isInativo ? (
                            <Badge variant="destructive">Inativo</Badge>
                          ) : isEstornado ? (
                            <Badge variant="secondary">Estornado</Badge>
                          ) : isEstorno ? (
                            <Badge variant="outline">Estorno</Badge>
                          ) : (
                            <Badge variant="default">Ativo</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {!isInativo && !isEstornado && !isEstorno && (
                            veioDeModulo ? (
                              // No lugar do X, o cadeado — e o motivo à mão, no
                              // hover e no clique (que é o que sobra no celular).
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => toast.info(motivoDoModulo(m.tipo))}
                                    className="text-muted-foreground hover:text-foreground"
                                  >
                                    <Lock className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  {motivoDoModulo(m.tipo)}
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDeactivateClick(m)}
                                disabled={saving}
                                title="Desativar movimento"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                            )
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="text-xs text-muted-foreground mt-4">
            <p>* Movimentos são imutáveis. Para remover um valor do MRR, desative o movimento (será contabilizado como churn).</p>
            <p className="mt-1">
              * <span className="text-amber-500">Ativação</span> é cobrança única: não entra no MRR e conta como
              faturamento no mês do movimento (Receita de Ativação, no painel de Vendas).
            </p>
            <p className="mt-1">
              * Movimento com <Lock className="inline h-3 w-3 align-[-2px]" /> nasceu de um módulo do cliente e acompanha
              a ficha — quem muda esse valor é o módulo, na aba Produtos.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Deactivate Confirmation Dialog */}
      <AlertDialog open={deactivateConfirm.open} onOpenChange={(open) => setDeactivateConfirm({ open, movimento: deactivateConfirm.movimento })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Desativação</AlertDialogTitle>
            <AlertDialogDescription>
              {deactivateConfirm.movimento && (
                <div className="space-y-2">
                  <p>Tem certeza que deseja desativar este movimento?</p>
                  <div className="bg-muted p-3 rounded-md text-sm">
                    <p><strong>Tipo:</strong> {TIPO_LABELS[deactivateConfirm.movimento.tipo]?.label}</p>
                    <p><strong>Valor:</strong> {formatCurrency(Math.abs(deactivateConfirm.movimento.valor_delta))}</p>
                    <p><strong>Data:</strong> {format(new Date(deactivateConfirm.movimento.data_movimento), 'dd/MM/yyyy')}</p>
                  </div>
                  <p className="text-destructive font-medium">
                    O valor de {formatCurrency(Math.abs(deactivateConfirm.movimento.valor_delta))} será removido do MRR e contabilizado como churn.
                  </p>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDeactivate}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
