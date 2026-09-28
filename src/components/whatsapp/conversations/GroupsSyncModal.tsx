import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Loader2, RefreshCw, Search, Settings2, Users, SearchX } from "lucide-react";
import {
  useGroupsAdminInstances,
  useGroupsAdminGroups,
  useSyncGroups,
  useToggleGroupEnabled,
} from "../hooks/useWhatsAppGroupsAdmin";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Visibilidade = "todos" | "no_chat" | "ocultos";

/**
 * Atalho do chat para Configurações > Operação > Grupos: sincronizar com o
 * WhatsApp e escolher quais grupos aparecem no sistema. Setor e retenção
 * continuam só na tela de Configurações.
 *
 * Layout próprio em vez de DialogHeader/ScrollArea, de propósito:
 * - DialogHeader tem -mx-6/-mt-6 casados com o p-6 do DialogContent; com p-0
 *   ele sai 24px para fora e corta o título.
 * - O Viewport do ScrollArea embrulha a lista em display:table, e o nome
 *   comprido de um grupo empurra os switches para fora (ver scroll-area.tsx).
 *   Um div overflow-y-auto com min-h-0 resolve sem o efeito colateral.
 */
export function GroupsSyncModal({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const [instanceId, setInstanceId] = useState("");
  const [search, setSearch] = useState("");
  const [visibilidade, setVisibilidade] = useState<Visibilidade>("todos");

  const { data: allInstances, isLoading: instancesLoading } = useGroupsAdminInstances();
  // Meta Cloud não tem grupos: nem aparece para escolha.
  const instances = useMemo(
    () => (allInstances ?? []).filter((i) => i.provider_type !== "meta_cloud"),
    [allInstances],
  );

  useEffect(() => {
    if (!open) return;
    if (!instanceId && instances.length > 0) setInstanceId(instances[0].id);
  }, [open, instanceId, instances]);

  useEffect(() => {
    setSearch("");
    setVisibilidade("todos");
  }, [instanceId]);

  const { data: groups, isLoading: groupsLoading } = useGroupsAdminGroups(instanceId);
  const syncMutation = useSyncGroups(instanceId);
  const toggleMutation = useToggleGroupEnabled(instanceId, groups);

  const total = groups?.length ?? 0;
  const noChat = (groups ?? []).filter((g) => g.enabled).length;

  const lastSyncedAt = useMemo(() => {
    const ts = (groups ?? [])
      .map((g) => (g.last_synced_at ? new Date(g.last_synced_at).getTime() : 0))
      .reduce((a, b) => Math.max(a, b), 0);
    return ts > 0 ? new Date(ts) : null;
  }, [groups]);

  const visibleGroups = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (groups ?? [])
      .filter((g) => visibilidade === "todos" || (visibilidade === "no_chat" ? g.enabled : !g.enabled))
      .filter((g) => !term || (g.group_name || g.group_jid).toLowerCase().includes(term))
      // Ativos primeiro: é o que a pessoa quer conferir ao abrir.
      .sort(
        (a, b) =>
          Number(b.enabled) - Number(a.enabled) ||
          (a.group_name || "").localeCompare(b.group_name || "", "pt-BR"),
      );
  }, [groups, search, visibilidade]);

  const segmentos: { value: Visibilidade; label: string; count: number }[] = [
    { value: "todos", label: "Todos", count: total },
    { value: "no_chat", label: "No chat", count: noChat },
    { value: "ocultos", label: "Ocultos", count: total - noChat },
  ];

  const hasGroups = !!instanceId && !groupsLoading && total > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // O foco automático caía no seletor de instância e o anel verde aparecia
        // cortado; ninguém abre este modal para trocar a instância primeiro.
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex flex-col gap-0 p-0 overflow-hidden sm:max-w-xl h-[min(680px,calc(100dvh-2rem))]"
      >
        {/* Cabeçalho */}
        <div className="shrink-0 px-6 pt-6 pb-4 pr-14">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Users className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <DialogTitle className="text-base leading-tight">Grupos do WhatsApp</DialogTitle>
              <DialogDescription className="text-sm">
                Escolha quais grupos aparecem no chat.
              </DialogDescription>
            </div>
          </div>
        </div>

        {/* Instância + sincronizar */}
        <div className="shrink-0 px-6 pb-4 space-y-2">
          <div className="flex items-center gap-2">
            <Select
              value={instanceId}
              onValueChange={setInstanceId}
              disabled={instancesLoading || instances.length === 0}
            >
              <SelectTrigger className="flex-1 min-w-0 h-10">
                <SelectValue placeholder={instancesLoading ? "Carregando instâncias..." : "Selecione a instância"} />
              </SelectTrigger>
              <SelectContent>
                {instances.map((inst) => (
                  <SelectItem key={inst.id} value={inst.id}>
                    {inst.display_name || inst.instance_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => syncMutation.mutate()}
              disabled={!instanceId || syncMutation.isPending}
              className="shrink-0 h-10"
            >
              <RefreshCw className={cn("h-4 w-4 mr-2", syncMutation.isPending && "animate-spin")} />
              {syncMutation.isPending ? "Sincronizando..." : "Sincronizar"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground min-h-4">
            {!instancesLoading && instances.length === 0
              ? "Nenhuma instância com suporte a grupos (Meta Cloud não suporta)."
              : lastSyncedAt
                ? `Última sincronização ${formatDistanceToNow(lastSyncedAt, { addSuffix: true, locale: ptBR })}`
                : instanceId && !groupsLoading
                  ? "Esta instância ainda não foi sincronizada."
                  : " "}
          </p>
        </div>

        {/* Busca + filtro */}
        {hasGroups && (
          <div className="shrink-0 px-6 pb-3 flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar grupo..."
                className="pl-9 h-9"
              />
            </div>
            <div className="inline-flex shrink-0 rounded-lg bg-muted p-0.5" role="tablist" aria-label="Filtrar grupos">
              {segmentos.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  role="tab"
                  aria-selected={visibilidade === s.value}
                  onClick={() => setVisibilidade(s.value)}
                  className={cn(
                    "h-8 px-2.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors",
                    visibilidade === s.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s.label}
                  <span className="ml-1 tabular-nums opacity-60">{s.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Lista */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain border-t border-border">
          {instanceId && groupsLoading && (
            <div className="px-6 py-3 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-1/2" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                  <Skeleton className="h-5 w-9 rounded-full" />
                </div>
              ))}
            </div>
          )}

          {instanceId && !groupsLoading && total === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-8">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <Users className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Nenhum grupo desta instância ainda</p>
                <p className="text-sm text-muted-foreground">
                  Clique em <strong className="text-foreground">Sincronizar</strong> para buscar os grupos no WhatsApp.
                </p>
              </div>
            </div>
          )}

          {hasGroups && visibleGroups.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center gap-2 px-8">
              <SearchX className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Nenhum grupo encontrado.</p>
            </div>
          )}

          {hasGroups && visibleGroups.length > 0 && (
            <ul className="divide-y divide-border">
              {visibleGroups.map((group) => {
                const saving = toggleMutation.isPending && toggleMutation.variables?.groupId === group.id;
                const nome = group.group_name || group.group_jid;
                return (
                  <li key={group.id}>
                    <label
                      htmlFor={`grp-${group.id}`}
                      className="flex items-center gap-3 px-6 py-3 cursor-pointer transition-colors hover:bg-muted/50"
                    >
                      <Avatar className="h-9 w-9 shrink-0">
                        {group.group_picture_url && <AvatarImage src={group.group_picture_url} alt="" />}
                        <AvatarFallback className="bg-muted">
                          <Users className="h-4 w-4 text-muted-foreground" />
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p
                          className={cn(
                            "text-sm truncate",
                            group.enabled ? "font-medium text-foreground" : "text-muted-foreground",
                          )}
                          title={nome}
                        >
                          {nome}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {typeof group.participant_count === "number"
                            ? `${group.participant_count} ${group.participant_count === 1 ? "participante" : "participantes"}`
                            : "Participantes não informados"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                        <Switch
                          id={`grp-${group.id}`}
                          checked={group.enabled}
                          onCheckedChange={(checked) => toggleMutation.mutate({ groupId: group.id, enabled: checked })}
                          disabled={saving}
                          aria-label={group.enabled ? `Ocultar ${nome} do chat` : `Mostrar ${nome} no chat`}
                        />
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Rodapé */}
        <div className="shrink-0 flex items-center justify-between gap-3 border-t border-border px-6 py-3">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => {
              onOpenChange(false);
              navigate("/configuracoes?section=operacao&sub=grupos");
            }}
          >
            <Settings2 className="h-4 w-4" />
            Setor e retenção
          </button>
          <div className="flex items-center gap-3">
            {hasGroups && (
              <span className="hidden sm:inline text-xs text-muted-foreground tabular-nums">
                {noChat} de {total} no chat
              </span>
            )}
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
