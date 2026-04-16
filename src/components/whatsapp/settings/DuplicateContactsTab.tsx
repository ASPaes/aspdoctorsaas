import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, GitMerge, EyeOff, Phone, MessageSquare, CheckCircle2, AlertTriangle, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface DuplicatePair {
  id_a: string; phone_a: string; name_a: string; conversations_a: number; last_message_a: string | null;
  id_b: string; phone_b: string; name_b: string; conversations_b: number; last_message_b: string | null;
}

function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) {
    const ddd = d.slice(2, 4);
    const num = d.slice(4);
    if (num.length === 9) return `+55 (${ddd}) ${num.slice(0, 5)}-${num.slice(5)}`;
    if (num.length === 8) return `+55 (${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`;
  }
  return phone;
}

function ContactCard({
  id, name, phone, conversations, lastMessage, isKeep, onSelect,
}: {
  id: string; name: string; phone: string; conversations: number; lastMessage: string | null;
  isKeep: boolean | null; onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex-1 rounded-lg border p-4 text-left transition-all hover:border-primary/50",
        isKeep === true && "border-primary bg-primary/5",
        isKeep === false && "border-destructive/50 bg-destructive/5 opacity-60",
        isKeep === null && "border-border"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-medium text-sm truncate">{name}</h4>
        {isKeep === true && (
          <Badge variant="default" className="shrink-0 text-xs">Manter</Badge>
        )}
        {isKeep === false && (
          <Badge variant="destructive" className="shrink-0 text-xs">Remover</Badge>
        )}
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Phone className="h-3 w-3 shrink-0" />
          <span className="truncate">{formatPhone(phone)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <MessageSquare className="h-3 w-3 shrink-0" />
          <span>{conversations} conversa{conversations !== 1 ? 's' : ''}</span>
        </div>
        {lastMessage && (
          <div className="text-xs">
            Última: {new Date(lastMessage).toLocaleDateString('pt-BR')}
          </div>
        )}
      </div>
    </button>
  );
}

function DuplicatePairCard({
  pair, onIgnore, onMerge,
}: {
  pair: DuplicatePair;
  onIgnore: () => void;
  onMerge: (keepId: string, mergeId: string) => void;
}) {
  const [keepId, setKeepId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const handleSelectKeep = (id: string) => {
    setKeepId(prev => prev === id ? null : id);
    setConfirming(false);
  };

  const mergeId = keepId === pair.id_a ? pair.id_b : pair.id_a;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0" />
          Possível duplicata
        </div>
        <Button variant="ghost" size="sm" onClick={onIgnore} className="h-7 text-xs shrink-0">
          <EyeOff className="h-3.5 w-3.5 mr-1" /> Ignorar
        </Button>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <ContactCard
          id={pair.id_a}
          name={pair.name_a}
          phone={pair.phone_a}
          conversations={pair.conversations_a}
          lastMessage={pair.last_message_a}
          isKeep={keepId === null ? null : keepId === pair.id_a}
          onSelect={() => handleSelectKeep(pair.id_a)}
        />
        <ContactCard
          id={pair.id_b}
          name={pair.name_b}
          phone={pair.phone_b}
          conversations={pair.conversations_b}
          lastMessage={pair.last_message_b}
          isKeep={keepId === null ? null : keepId === pair.id_b}
          onSelect={() => handleSelectKeep(pair.id_b)}
        />
      </div>

      {keepId && !confirming && (
        <div className="flex items-center justify-between rounded-md bg-muted p-3">
          <p className="text-xs text-muted-foreground">
            Clique em confirmar para unificar. Todas as conversas do contato removido serão transferidas.
          </p>
          <Button size="sm" onClick={() => setConfirming(true)}>
            <GitMerge className="h-3.5 w-3.5 mr-1" /> Unificar
          </Button>
        </div>
      )}

      {confirming && keepId && (
        <div className="rounded-md border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/40 p-3 space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-yellow-800 dark:text-yellow-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Confirma a unificação? Esta ação não pode ser desfeita.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button size="sm" className="flex-1 h-7 text-xs" onClick={() => onMerge(keepId, mergeId)}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Confirmar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DuplicateContactsTab() {
  const { profile } = useAuth();
  const { effectiveTenantId } = useTenantFilter();
  const tenantId = effectiveTenantId || profile?.tenant_id;
  const queryClient = useQueryClient();
  const [ignored, setIgnored] = useState<Set<string>>(new Set());

  const { data: pairs, isLoading } = useQuery({
    queryKey: ['duplicate-contacts', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await (supabase.rpc as any)('get_duplicate_contacts', { p_tenant_id: tenantId });
      if (error) throw error;
      return (data || []) as DuplicatePair[];
    },
    enabled: !!tenantId,
    staleTime: 30_000,
  });

  const mergeMutation = useMutation({
    mutationFn: async ({ keepId, mergeId }: { keepId: string; mergeId: string }) => {
      const { error } = await (supabase.rpc as any)('merge_whatsapp_contacts', {
        p_keep_id: keepId,
        p_merge_id: mergeId,
        p_tenant_id: tenantId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Contatos unificados com sucesso');
      queryClient.invalidateQueries({ queryKey: ['duplicate-contacts'] });
    },
    onError: () => toast.error('Erro ao unificar contatos'),
  });

  const pairKey = (pair: DuplicatePair) => `${pair.id_a}:${pair.id_b}`;

  const [search, setSearch] = useState('');

  const visiblePairs = (pairs || []).filter(p => {
    if (ignored.has(pairKey(p))) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      p.name_a?.toLowerCase().includes(q) ||
      p.name_b?.toLowerCase().includes(q) ||
      p.phone_a?.includes(q) ||
      p.phone_b?.includes(q)
    );
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (visiblePairs.length === 0 && !search.trim() && (pairs || []).filter(p => !ignored.has(pairKey(p))).length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center space-y-2">
        <CheckCircle2 className="h-8 w-8 text-green-500" />
        <p className="text-sm font-medium">Nenhum contato duplicado encontrado</p>
        <p className="text-xs text-muted-foreground">Sua base de contatos está organizada.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="shrink-0">
          <h3 className="text-sm font-medium">
            {visiblePairs.length} par{visiblePairs.length !== 1 ? 'es' : ''} encontrado{visiblePairs.length !== 1 ? 's' : ''}
          </h3>
          <p className="text-xs text-muted-foreground">
            Clique no contato que deseja manter, depois em Unificar.
          </p>
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por nome ou telefone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {visiblePairs.length === 0 && search.trim() && (
        <div className="flex flex-col items-center justify-center py-8 text-center space-y-1">
          <p className="text-sm font-medium">Nenhum resultado para "{search}"</p>
          <p className="text-xs text-muted-foreground">Tente outro nome ou telefone.</p>
        </div>
      )}

      <div className="space-y-3">
        {visiblePairs.map(pair => (
          <DuplicatePairCard
            key={pairKey(pair)}
            pair={pair}
            onIgnore={() => setIgnored(prev => new Set([...prev, pairKey(pair)]))}
            onMerge={(keepId, mergeId) => mergeMutation.mutate({ keepId, mergeId })}
          />
        ))}
      </div>
    </div>
  );
}
