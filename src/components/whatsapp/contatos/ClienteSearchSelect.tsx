import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useClienteSearch } from '../hooks/useClienteSearch';
import { Search, Loader2, X, Link2 } from 'lucide-react';

export interface SelectedCliente {
  id: string;
  label: string;
}

interface ClienteSearchSelectProps {
  value: SelectedCliente | null;
  onChange: (value: SelectedCliente | null) => void;
  placeholder?: string;
  includeCancelados?: boolean;
  /** id para acessibilidade (liga um <Label htmlFor>). */
  inputId?: string;
}

/**
 * Seletor de cliente com busca (nome / CNPJ / código) reutilizável.
 * Mesmo padrão do EditContactModal, extraído para uso no cadastro de contato
 * e no filtro da tela de contatos.
 */
export function ClienteSearchSelect({
  value,
  onChange,
  placeholder = 'Buscar por nome, CNPJ ou código...',
  includeCancelados = false,
  inputId,
}: ClienteSearchSelectProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const { results, isLoading } = useClienteSearch(searchOpen ? searchTerm : '', includeCancelados);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
        <Link2 className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-medium truncate flex-1">{value.label}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
          onClick={() => onChange(null)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          id={inputId}
          value={searchTerm}
          onChange={(e) => { setSearchTerm(e.target.value); setSearchOpen(true); }}
          onFocus={() => setSearchOpen(true)}
          placeholder={placeholder}
          className="text-sm pl-8"
        />
      </div>
      {searchOpen && searchTerm.length >= 2 && (
        <div className="border border-border rounded-md max-h-40 overflow-y-auto">
          {isLoading && (
            <div className="flex justify-center py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {results.length > 0 && results.map((c) => (
            <button
              key={c.id}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-accent text-xs flex items-center justify-between gap-2 transition-colors"
              onClick={() => {
                onChange({
                  id: c.id,
                  label: `#${c.codigo_sequencial} — ${c.nome_fantasia || c.razao_social || 'Sem nome'}`,
                });
                setSearchOpen(false);
                setSearchTerm('');
              }}
            >
              <span className="truncate">
                <span className="text-muted-foreground">#{c.codigo_sequencial}</span>{' '}
                {c.nome_fantasia || c.razao_social}
                {c.cancelado && <span className="ml-1 text-[10px] text-amber-600">(cancelado)</span>}
              </span>
              <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
            </button>
          ))}
          {!isLoading && results.length === 0 && (
            <p className="text-[11px] text-muted-foreground text-center py-2">Nenhum cliente encontrado</p>
          )}
        </div>
      )}
    </div>
  );
}
