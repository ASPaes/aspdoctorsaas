// Campos dos "Filtros Avançados" da carteira de clientes, e os dois conjuntos
// de ids que alguns filtros precisam (matrizes e produto/módulo).
//
// Fonte única: a tela de Clientes e o Envio em lote usam este componente. Ver
// src/lib/filtrosClientes.ts para a regra de cada filtro.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLookups } from "@/hooks/useLookups";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { temFiltroDeProduto, type FiltrosClientes } from "@/lib/filtrosClientes";

type Chave = keyof FiltrosClientes;

function RangeInput({ label, min, max, onMinChange, onMaxChange, prefix }: {
  label: string; min: string; max: string; onMinChange: (v: string) => void; onMaxChange: (v: string) => void; prefix?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="flex gap-1">
        <Input type="text" inputMode="decimal" placeholder={prefix ? `${prefix} Min` : "Min"} value={min} onChange={(e) => onMinChange(e.target.value)} className="h-8 text-xs" />
        <Input type="text" inputMode="decimal" placeholder={prefix ? `${prefix} Max` : "Max"} value={max} onChange={(e) => onMaxChange(e.target.value)} className="h-8 text-xs" />
      </div>
    </div>
  );
}

interface Props {
  filtros: FiltrosClientes;
  onChange: <K extends Chave>(chave: K, valor: FiltrosClientes[K]) => void;
  /** Prefixo dos ids dos checkboxes, para a tela poder ter dois blocos sem colidir. */
  idPrefixo?: string;
}

export function FiltrosAvancadosClientesCampos({ filtros, onChange, idPrefixo = "clientes" }: Props) {
  const {
    periodoCadastro, periodoCancelamento, periodoVenda, periodoAtivacao,
    recorrenciaAdv, modeloContratoId, produtoId, origemVendaId, areaAtuacaoId, segmentoId,
    funcionarioId, fornecedorId, estadoId, cidadeId, motivoCancelamentoId, moduloIds,
    mensalidadeMin, mensalidadeMax, lucroMin, lucroMax, margemMin, margemMax,
    somenteMatrizes, apenasSetupIncompleto,
  } = filtros;

  const estadoIdNumeric = estadoId && estadoId !== "__null__" ? Number(estadoId) : null;
  const lookups = useLookups(estadoIdNumeric);

  const filteredModulos = useMemo(() => {
    const all = lookups.produtoModulos.data || [];
    if (!produtoId) return all;
    return all.filter((m) => String(m.produto_id) === produtoId);
  }, [lookups.produtoModulos.data, produtoId]);

  const selVal = (v: string) => v || "__all__";
  const selChange = (key: Chave) => (v: string) => onChange(key, (v === "__all__" ? "" : v) as any);

  return (
    <div className="space-y-4">
      {/* Row 1 - Date ranges */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <DateRangePicker label="Período de Cadastro" value={periodoCadastro} onChange={(v) => onChange("periodoCadastro", v)} />
        <DateRangePicker label="Período de Cancelamento" value={periodoCancelamento} onChange={(v) => onChange("periodoCancelamento", v)} />
        <DateRangePicker label="Período da Venda" value={periodoVenda} onChange={(v) => onChange("periodoVenda", v)} />
        <DateRangePicker label="Período de Ativação" value={periodoAtivacao} onChange={(v) => onChange("periodoAtivacao", v)} />
      </div>

      {/* Row 2 - Lookups */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Recorrência</label>
          <Select value={selVal(recorrenciaAdv)} onValueChange={selChange("recorrenciaAdv")}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas</SelectItem>
              <SelectItem value="__null__">Nulo</SelectItem>
              <SelectItem value="mensal">Mensal</SelectItem>
              <SelectItem value="semestral">Semestral</SelectItem>
              <SelectItem value="anual">Anual</SelectItem>
              <SelectItem value="semanal">Semanal</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Modelo de Contrato</label>
          <Select value={selVal(modeloContratoId)} onValueChange={selChange("modeloContratoId")}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              <SelectItem value="__null__">Nulo</SelectItem>
              {lookups.modelosContrato.data?.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Produto</label>
          <Select value={selVal(produtoId)} onValueChange={selChange("produtoId")}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              <SelectItem value="__null__">Nulo</SelectItem>
              {lookups.produtos.data?.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Origem da Venda</label>
          <Select value={selVal(origemVendaId)} onValueChange={selChange("origemVendaId")}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas</SelectItem>
              <SelectItem value="__null__">Nulo</SelectItem>
              {lookups.origensVenda.data?.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Row 3 - More lookups */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Área de Atuação</label>
          <Select value={selVal(areaAtuacaoId)} onValueChange={selChange("areaAtuacaoId")}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas</SelectItem>
              <SelectItem value="__null__">Nulo</SelectItem>
              {lookups.areasAtuacao.data?.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Segmento</label>
          <Select value={selVal(segmentoId)} onValueChange={selChange("segmentoId")}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              <SelectItem value="__null__">Nulo</SelectItem>
              {lookups.segmentos.data?.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Funcionário</label>
          <Select value={selVal(funcionarioId)} onValueChange={selChange("funcionarioId")}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              <SelectItem value="__null__">Nulo</SelectItem>
              {lookups.funcionarios.data?.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Fornecedor</label>
          <Select value={selVal(fornecedorId)} onValueChange={selChange("fornecedorId")}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              <SelectItem value="__null__">Nulo</SelectItem>
              {lookups.fornecedores.data?.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Row 4 - Estado/Cidade/Motivo/Mensalidade */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Estado</label>
          <Select value={selVal(estadoId)} onValueChange={selChange("estadoId")}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              <SelectItem value="__null__">Nulo</SelectItem>
              {lookups.estados.data?.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.sigla} - {e.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Cidade</label>
          <Select value={selVal(cidadeId)} onValueChange={selChange("cidadeId")} disabled={!estadoIdNumeric}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={estadoIdNumeric ? undefined : "Selecione estado"} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas</SelectItem>
              <SelectItem value="__null__">Nulo</SelectItem>
              {lookups.cidades.data?.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Motivo Cancelamento</label>
          <Select value={selVal(motivoCancelamentoId)} onValueChange={selChange("motivoCancelamentoId")}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              <SelectItem value="__null__">Nulo</SelectItem>
              {lookups.motivosCancelamento.data?.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.descricao}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <RangeInput label="Mensalidade R$" min={mensalidadeMin} max={mensalidadeMax} onMinChange={(v) => onChange("mensalidadeMin", v)} onMaxChange={(v) => onChange("mensalidadeMax", v)} prefix="R$" />
      </div>

      {/* Row 5 - Numeric ranges */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <RangeInput label="Lucro Real R$" min={lucroMin} max={lucroMax} onMinChange={(v) => onChange("lucroMin", v)} onMaxChange={(v) => onChange("lucroMax", v)} prefix="R$" />
        <RangeInput label="Margem %" min={margemMin} max={margemMax} onMinChange={(v) => onChange("margemMin", v)} onMaxChange={(v) => onChange("margemMax", v)} prefix="%" />
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Módulos</label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 w-full justify-between text-xs font-normal">
                <span className="truncate">
                  {moduloIds.length > 0
                    ? `${moduloIds.length} módulo(s) selecionado(s)`
                    : "Selecionar módulos..."}
                </span>
                <ChevronDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[260px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Buscar módulo..." className="h-8" />
                <CommandList>
                  <CommandEmpty>Nenhum módulo encontrado.</CommandEmpty>
                  <CommandGroup>
                    {filteredModulos.map((mod) => {
                      const isSelected = moduloIds.includes(mod.id);
                      return (
                        <CommandItem
                          key={mod.id}
                          value={mod.nome}
                          onSelect={() => {
                            const next = isSelected
                              ? moduloIds.filter((id) => id !== mod.id)
                              : [...moduloIds, mod.id];
                            onChange("moduloIds", next);
                          }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
                          {mod.nome}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex flex-col gap-2 pt-5">
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${idPrefixo}-somente-matrizes`}
              checked={somenteMatrizes}
              onCheckedChange={(v) => onChange("somenteMatrizes", !!v)}
            />
            <label htmlFor={`${idPrefixo}-somente-matrizes`} className="text-sm cursor-pointer select-none whitespace-nowrap">
              Somente Matrizes
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${idPrefixo}-apenas-setup-incompleto`}
              checked={apenasSetupIncompleto}
              onCheckedChange={(v) => onChange("apenasSetupIncompleto", !!v)}
            />
            <label htmlFor={`${idPrefixo}-apenas-setup-incompleto`} className="text-sm cursor-pointer select-none whitespace-nowrap">
              Apenas setup incompleto
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Ids dos clientes que são matriz (têm ao menos uma filial). */
export function useIdsMatriz(tid: string | null, enabled = true) {
  return useQuery({
    queryKey: ["matriz_ids", tid],
    enabled,
    queryFn: async () => {
      const rows = await fetchAllRows<any>(() => {
        let q = (supabase.from("clientes") as any).select("matriz_id").not("matriz_id", "is", null);
        if (tid) q = q.eq("tenant_id", tid);
        return q;
      });
      return new Set<string>(rows.map((r) => r.matriz_id).filter(Boolean));
    },
  });
}

/** Ids dos clientes com produto ativo que casa com fornecedor/produto/módulos. */
export function useIdsPorProduto(
  f: Pick<FiltrosClientes, "fornecedorId" | "produtoId" | "moduloIds">,
  tid: string | null,
) {
  const { fornecedorId, produtoId, moduloIds } = f;
  return useQuery({
    queryKey: ["product_filter_client_ids", fornecedorId, produtoId, moduloIds, tid],
    enabled: temFiltroDeProduto(f),
    staleTime: 30_000,
    queryFn: async () => {
      let moduleFilterCpIds: Set<string> | null = null;
      if (moduloIds.length > 0) {
        const cpmRows = await fetchAllRows<any>(() =>
          (supabase.from("cliente_produto_modulos" as any) as any)
            .select("cliente_produto_id")
            .in("modulo_id", moduloIds)
            .eq("ativo", true),
        );
        moduleFilterCpIds = new Set((cpmRows || []).map((r: any) => r.cliente_produto_id));
      }

      const cpRows = await fetchAllRows<any>(() => {
        let q = (supabase.from("cliente_produtos" as any) as any)
          .select("id, cliente_id")
          .eq("ativo", true);
        if (tid) q = q.eq("tenant_id", tid);
        if (fornecedorId === "__null__") q = q.is("fornecedor_id", null);
        else if (fornecedorId) q = q.eq("fornecedor_id", Number(fornecedorId));
        if (produtoId === "__null__") q = q.is("produto_id", null);
        else if (produtoId) q = q.eq("produto_id", Number(produtoId));
        return q;
      });

      let filteredCpRows = cpRows || [];
      if (moduleFilterCpIds) {
        filteredCpRows = filteredCpRows.filter((r: any) => moduleFilterCpIds!.has(r.id));
      }
      return new Set<string>(filteredCpRows.map((r: any) => r.cliente_id));
    },
  });
}
