import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
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
import { Loader2, Plus, XCircle, TrendingUp, TrendingDown, ArrowUpDown, AlertCircle, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MovimentoMrr {
  id: string;
  cliente_id: string;
  tipo: 'upsell' | 'cross_sell' | 'downsell' | 'venda_avulsa';
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
}

interface MovimentosMrrModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clienteId: string;
  clienteNome: string;
  mensalidadeBase: number;
  custoBase: number;
  funcionarios: { id: number; nome: string }[];
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
  clienteNome,
  mensalidadeBase,
  custoBase,
  funcionarios,
}: MovimentosMrrModalProps) {
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
  const [origemVenda, setOrigemVenda] = useState('');
  const [descricao, setDescricao] = useState('');
  const [funcionarioId, setFuncionarioId] = useState<string>('');

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
    }
  }, [open, clienteId]);

  // beforeunload guard when add form is open
  const isFormDirty = showAddForm && (!!valorDelta || !!custoDelta || !!valorVendaAvulsa || !!descricao || !!funcionarioId);
  useEffect(() => {
    if (!isFormDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isFormDirty]);

  // Calculations
  const movimentosAtivos = movimentos.filter(m => m.status === 'ativo' && !m.estornado_por && !m.estorno_de && m.tipo !== 'venda_avulsa');
  const vendasAvulsasAtivas = movimentos.filter(m => m.status === 'ativo' && m.tipo === 'venda_avulsa');

  const somaMovimentosAtivos = movimentosAtivos.reduce((sum, m) => sum + m.valor_delta, 0);
  const totalVendasAvulsas = vendasAvulsasAtivas.reduce((sum, m) => sum + (m.valor_venda_avulsa || 0), 0);
  const somaCustoMovimentos = movimentosAtivos.reduce((sum, m) => sum + (m.custo_delta || 0), 0);

  const mrrAjustado = mensalidadeBase + somaMovimentosAtivos;
  const custoAjustado = custoBase + somaCustoMovimentos;

  const totalUpsell = movimentosAtivos.filter(m => m.tipo === 'upsell').reduce((sum, m) => sum + m.valor_delta, 0);
  const totalCrossSell = movimentosAtivos.filter(m => m.tipo === 'cross_sell').reduce((sum, m) => sum + m.valor_delta, 0);
  const totalDownsell = movimentosAtivos.filter(m => m.tipo === 'downsell').reduce((sum, m) => sum + Math.abs(m.valor_delta), 0);

  const totalCustoUpsell = movimentosAtivos.filter(m => m.tipo === 'upsell').reduce((sum, m) => sum + (m.custo_delta || 0), 0);
  const totalCustoCrossSell = movimentosAtivos.filter(m => m.tipo === 'cross_sell').reduce((sum, m) => sum + (m.custo_delta || 0), 0);
  const totalCustoDownsell = movimentosAtivos.filter(m => m.tipo === 'downsell').reduce((sum, m) => sum + Math.abs(m.custo_delta || 0), 0);

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
    setOrigemVenda('');
    setDescricao('');
    setFuncionarioId('');
    setShowAddForm(false);
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

      const { error } = await supabase
        .from('movimentos_mrr')
        .insert(insertData);

      if (error) throw error;

      toast.success('Movimento registrado com sucesso');
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
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowUpDown className="h-5 w-5" />
              Movimentos de MRR
            </DialogTitle>
            <DialogDescription>{clienteNome}</DialogDescription>
          </DialogHeader>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
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
                <p className="text-xs text-muted-foreground">Não afeta MRR</p>
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
              <div className="grid grid-cols-2 gap-4">
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
                <CardTitle className="text-base">Novo Movimento</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Tipo *</Label>
                    <Select value={tipo} onValueChange={(v: any) => setTipo(v)}>
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
                    <Input type="date" value={dataMovimento} onChange={(e) => setDataMovimento(e.target.value)} />
                  </div>
                </div>

                {/* Funcionário select */}
                <div className="space-y-2">
                  <Label>Funcionário Responsável *</Label>
                  <Select value={funcionarioId} onValueChange={setFuncionarioId}>
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
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Valor da Venda Avulsa (R$) *</Label>
                      <Input type="number" step="0.01" min="0.01" placeholder="Ex: 500.00" value={valorVendaAvulsa} onChange={(e) => setValorVendaAvulsa(e.target.value)} />
                      <p className="text-xs text-muted-foreground">Este valor será contabilizado na Meta de Ativação (R$) do mês</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Origem</Label>
                      <Input placeholder="Ex: Indicação, Campanha, etc." value={origemVenda} onChange={(e) => setOrigemVenda(e.target.value)} />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Valor MRR (R$) *</Label>
                      <Input type="number" step="0.01" min="0.01" placeholder="Ex: 500.00" value={valorDelta} onChange={(e) => setValorDelta(e.target.value)} />
                      <p className="text-xs text-muted-foreground">
                        {tipo === 'downsell' ? 'Valor será subtraído do MRR' : 'Valor será somado ao MRR'}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>Custo (R$)</Label>
                      <Input type="number" step="0.01" min="0" placeholder="Ex: 200.00" value={custoDelta} onChange={(e) => setCustoDelta(e.target.value)} />
                      <p className="text-xs text-muted-foreground">
                        {tipo === 'downsell' ? 'Custo será subtraído' : 'Custo adicional do movimento'}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>Origem</Label>
                      <Input placeholder="Ex: Indicação, Campanha, etc." value={origemVenda} onChange={(e) => setOrigemVenda(e.target.value)} />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Descrição</Label>
                  <Textarea placeholder="Detalhes do movimento..." value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} />
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleSubmit} disabled={saving}>
                    {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Salvar
                  </Button>
                  <Button variant="outline" onClick={resetForm}>Cancelar</Button>
                </div>
              </CardContent>
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
