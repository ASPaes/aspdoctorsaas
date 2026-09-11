import { useMemo, useState } from 'react';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MultiSelectFilter } from '@/components/atendimento/MultiSelectFilter';
import { useLookups } from '@/hooks/useLookups';
import { cn } from '@/lib/utils';
import {
  FAIXAS_MENSALIDADE,
  COHORT_FILTROS_VAZIO,
  contarFiltrosAtivos,
  type CohortFiltros,
  type FaixaMensalidade,
} from './hooks/cohortFiltros';

interface CohortFiltrosBarProps {
  value: CohortFiltros;
  onChange: (f: CohortFiltros) => void;
  /** Fornecedor mora no estado do Dashboard porque as outras abas também o usam.
   *  Nesta aba ele sai da barra global e aparece aqui, como um controle só. */
  fornecedorIds: number[];
  onFornecedorChange: (ids: number[]) => void;
  className?: string;
}

export function CohortFiltrosBar({ value, onChange, fornecedorIds, onFornecedorChange, className }: CohortFiltrosBarProps) {
  const [aberto, setAberto] = useState(false);

  /** Cidade só faz sentido dentro de um estado: `useLookups` carrega uma UF por
   *  vez (MG sozinha passa de 850 cidades). Com 0 ou 2+ estados o campo fica
   *  desabilitado em vez de mostrar uma lista incompleta. */
  const estadoUnico = value.estadoIds.length === 1 ? value.estadoIds[0] : null;
  const { estados, cidades, areasAtuacao, segmentos, funcionarios, produtos, origensVenda, fornecedores } =
    useLookups(estadoUnico);

  const set = (patch: Partial<CohortFiltros>) => onChange({ ...value, ...patch });

  const opcoesEstado = useMemo(
    () => (estados.data ?? []).map((e: any) => ({ id: e.id as number, nome: `${e.sigla} — ${e.nome}` })),
    [estados.data]
  );
  const opcoesCidade = useMemo(
    () => (cidades.data ?? []).map((c: any) => ({ id: c.id as number, nome: c.nome as string })),
    [cidades.data]
  );
  const simples = (rows: any[] | undefined) =>
    (rows ?? []).map((r: any) => ({ id: r.id as number, nome: (r.nome ?? r.descricao) as string }));

  const ativos = contarFiltrosAtivos(value) + (fornecedorIds.length > 0 ? 1 : 0);

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center gap-2">
        <Button
          variant={ativos > 0 ? 'default' : 'outline'}
          size="sm"
          onClick={() => setAberto(o => !o)}
          className="gap-2"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filtros
          {ativos > 0 && (
            <Badge variant="secondary" className="ml-0.5">{ativos}</Badge>
          )}
          <ChevronDown className={cn('h-4 w-4 transition-transform', aberto && 'rotate-180')} />
        </Button>
        {ativos > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { onChange(COHORT_FILTROS_VAZIO); onFornecedorChange([]); }}
            className="gap-1.5 text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Limpar
          </Button>
        )}
      </div>

      {aberto && (
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="flex flex-wrap gap-3">
            <Campo label="Fornecedor">
              <MultiSelectFilter
                label={rotulo(fornecedorIds.length, 'Todos os fornecedores', 'fornecedor', 'fornecedores')}
                options={simples(fornecedores.data)}
                selected={fornecedorIds}
                onChange={onFornecedorChange}
                searchPlaceholder="Buscar fornecedor..."
                className="w-[190px]"
              />
            </Campo>

            <Campo label="Segmento">
              <MultiSelectFilter
                label={rotulo(value.segmentoIds.length, 'Todos os segmentos', 'segmento', 'segmentos')}
                options={simples(segmentos.data)}
                selected={value.segmentoIds}
                onChange={ids => set({ segmentoIds: ids })}
                searchPlaceholder="Buscar segmento..."
                className="w-[190px]"
              />
            </Campo>

            <Campo label="Área de atuação">
              <MultiSelectFilter
                label={rotulo(value.areaAtuacaoIds.length, 'Todas as áreas', 'área', 'áreas')}
                options={simples(areasAtuacao.data)}
                selected={value.areaAtuacaoIds}
                onChange={ids => set({ areaAtuacaoIds: ids })}
                searchPlaceholder="Buscar área..."
                className="w-[190px]"
              />
            </Campo>

            <Campo label="Vendedor">
              <MultiSelectFilter
                label={rotulo(value.funcionarioIds.length, 'Todos os vendedores', 'vendedor', 'vendedores')}
                options={simples(funcionarios.data)}
                selected={value.funcionarioIds}
                onChange={ids => set({ funcionarioIds: ids })}
                searchPlaceholder="Buscar vendedor..."
                className="w-[190px]"
              />
            </Campo>

            <Campo label="Produto">
              <MultiSelectFilter
                label={rotulo(value.produtoIds.length, 'Todos os produtos', 'produto', 'produtos')}
                options={simples(produtos.data)}
                selected={value.produtoIds}
                onChange={ids => set({ produtoIds: ids })}
                searchPlaceholder="Buscar produto..."
                className="w-[190px]"
              />
            </Campo>

            <Campo label="Faixa de mensalidade">
              <MultiSelectFilter<FaixaMensalidade>
                label={rotulo(value.faixas.length, 'Todas as faixas', 'faixa', 'faixas')}
                options={FAIXAS_MENSALIDADE.map(f => ({ id: f.id, nome: f.nome }))}
                selected={value.faixas}
                onChange={ids => set({ faixas: ids })}
                searchPlaceholder="Buscar faixa..."
                className="w-[190px]"
              />
            </Campo>

            <Campo label="Origem da venda">
              <MultiSelectFilter
                label={rotulo(value.origemVendaIds.length, 'Todas as origens', 'origem', 'origens')}
                options={simples(origensVenda.data)}
                selected={value.origemVendaIds}
                onChange={ids => set({ origemVendaIds: ids })}
                searchPlaceholder="Buscar origem..."
                className="w-[190px]"
              />
            </Campo>

            <Campo label="Estado">
              <MultiSelectFilter
                label={rotulo(value.estadoIds.length, 'Todos os estados', 'estado', 'estados')}
                options={opcoesEstado}
                selected={value.estadoIds}
                /* Trocar de estado invalida as cidades escolhidas do estado anterior. */
                onChange={ids => set({ estadoIds: ids, cidadeIds: [] })}
                searchPlaceholder="Buscar estado..."
                className="w-[190px]"
              />
            </Campo>

            <Campo
              label="Cidade"
              hint={
                value.estadoIds.length === 0
                  ? 'escolha um estado'
                  : value.estadoIds.length > 1
                    ? 'um estado por vez'
                    : undefined
              }
            >
              <MultiSelectFilter
                label={
                  estadoUnico == null
                    ? 'Todas as cidades'
                    : rotulo(value.cidadeIds.length, 'Todas as cidades', 'cidade', 'cidades')
                }
                options={opcoesCidade}
                selected={value.cidadeIds}
                onChange={ids => set({ cidadeIds: ids })}
                searchPlaceholder="Buscar cidade..."
                className={cn('w-[190px]', estadoUnico == null && 'pointer-events-none opacity-50')}
              />
            </Campo>
          </div>
        </div>
      )}
    </div>
  );
}

function Campo({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {label}
        {hint && <span className="font-normal italic opacity-70">({hint})</span>}
      </label>
      {children}
    </div>
  );
}

/** Rótulo do botão. O texto de "nenhum selecionado" vem pronto porque deduzir
 *  gênero pela terminação erra em "origem" e "cidade". */
function rotulo(n: number, todos: string, singular: string, plural: string): string {
  if (n === 0) return todos;
  if (n === 1) return `1 ${singular}`;
  return `${n} ${plural}`;
}
