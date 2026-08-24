import { AlertTriangle, Bell, Check, CheckCheck, ExternalLink, Eye } from "lucide-react";
import { useNotifications, NotificationItem } from "@/hooks/useNotifications";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export function NotificationBell() {
  const {
    unreadCount,
    notifications,
    systemNotifications,
    operationNotifications,
    integrationNotifications,
    systemUnreadCount,
    operationUnreadCount,
    integrationUnreadCount,
    markRead,
    dismiss,
    markAllRead,
    dismissAll,
  } = useNotifications();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"operation" | "system" | "integration">("operation");

  // Fila travada é assunto de quem administra o tenant: mesma definição de admin do
  // resto do sistema (Configuracoes.tsx). Quem não é admin só vê a aba se alguém o
  // inscreveu no evento de propósito — sem isso, ela seria uma aba sempre vazia.
  const isAdmin = !!(profile?.role === "admin" || profile?.is_super_admin);
  const mostrarIntegracoes = isAdmin || integrationNotifications.length > 0;
  // A aba pode sumir debaixo de quem está nela: um não-admin inscrito que dispensa a
  // última notificação de integração ficaria olhando um painel sem conteúdo nenhum.
  const abaEfetiva = activeTab === "integration" && !mostrarIntegracoes ? "operation" : activeTab;

  useEffect(() => {
    if (!open || operationUnreadCount > 0) return;
    // Abrir o sino já na aba que tem o que ler; Operação continua tendo a preferência.
    if (mostrarIntegracoes && integrationUnreadCount > 0) setActiveTab("integration");
    else if (systemUnreadCount > 0) setActiveTab("system");
  }, [open, systemUnreadCount, operationUnreadCount, integrationUnreadCount, mostrarIntegracoes]);

  const handleItemClick = (item: NotificationItem) => {
    // Se a notificação leva a uma conversa, dispensar (sumir do sino) ao navegar
    if (item.notification.action_url) {
      dismiss(item.id);
      setOpen(false);
      navigate(item.notification.action_url);
      return;
    }
    // Caso contrário, apenas marcar como lida
    if (!item.read_at) {
      markRead(item.id);
    }
  };

  const severityIcon = (severity: string) => {
    switch (severity) {
      case "warning":
        return "🟡";
      case "error":
        return "🔴";
      case "critical":
        return "🔴";
      default:
        return "🔵";
    }
  };

  const renderList = (items: NotificationItem[], isSystem: boolean, vazio = "Nenhuma notificação") => {
    if (items.length === 0) {
      return (
        <div className="p-6 text-center text-sm text-muted-foreground">
          {vazio}
        </div>
      );
    }
    return (
      <div className="max-h-[420px] overflow-y-auto divide-y">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors",
              !item.read_at && "bg-accent/20",
              isSystem && item.notification.severity === "critical" && "border-l-2 border-destructive"
            )}
            onClick={() => handleItemClick(item)}
          >
            <span className="text-sm mt-0.5 shrink-0">{severityIcon(item.notification.severity)}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <p className={cn("text-sm leading-tight truncate flex-1", !item.read_at && "font-medium")}>
                  {item.notification.title}
                </p>
                {item.silent_mode && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Eye className="h-3 w-3 text-muted-foreground shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">
                      Monitorando outro setor
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              {(() => {
                const unreadCount = item.notification.metadata?.unread_count ?? 1;
                const hasMultiple = unreadCount > 1;
                return (
                  <>
                    {hasMultiple && (
                      <p className="text-[10px] text-primary font-medium mt-0.5">
                        {unreadCount} mensagens novas
                      </p>
                    )}
                    {item.notification.body && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {item.notification.body}
                      </p>
                    )}
                  </>
                );
              })()}
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {formatDistanceToNow(new Date(item.delivered_at), { addSuffix: true, locale: ptBR })}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0 mt-0.5">
              {!item.read_at && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={(e) => {
                        e.stopPropagation();
                        markRead(item.id);
                      }}
                    >
                      <Check className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Marcar como lida</TooltipContent>
                </Tooltip>
              )}
              {item.notification.action_url && (
                <ExternalLink className="h-3 w-3 text-muted-foreground" />
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8"
          aria-label={
            integrationUnreadCount > 0
              ? "Notificações, com integração parada"
              : "Notificações"
          }
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] leading-none flex items-center justify-center rounded-full"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
          {/* Integração parada tem cara própria: o número vermelho diz QUANTAS coisas
              há para ler, e este triângulo diz que uma delas é a fila travada, que
              ninguém mais vai destravar sozinha. Canto oposto ao da contagem para os
              dois não brigarem, e sobre um disco da cor do fundo para o símbolo se
              ler por cima do ícone. Parado aqui: o halo pulsando fica na aba, dentro
              do painel aberto. */}
          {integrationUnreadCount > 0 && (
            <span
              className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background"
              aria-hidden="true"
            >
              <AlertTriangle className="h-3 w-3 text-amber-500 dark:text-amber-400" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      {/* Três abas não cabem em 320px: a terceira leva triângulo, rótulo e contagem
          na mesma linha, e em 320 o "Integrações" quebrava em duas. */}
      <PopoverContent align="end" className={cn("p-0", mostrarIntegracoes ? "w-[26rem]" : "w-80")} sideOffset={8}>
        {/* Header */}
        <div className="flex items-center justify-between border-b px-3 py-2 gap-2">
          <span className="text-sm font-semibold">Notificações</span>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={markAllRead}>
                <CheckCheck className="h-3 w-3" />
                Marcar todas
              </Button>
            )}
            {notifications.length > 0 && (
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => dismissAll()}>
                Limpar todas
              </Button>
            )}
          </div>
        </div>

        <Tabs value={abaEfetiva} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="w-full">
          <TabsList className="w-full rounded-none border-b bg-transparent h-9 px-2 gap-2">
            <TabsTrigger value="operation" className="flex-1 text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none rounded-sm">
              Operação
              {operationUnreadCount > 0 && (
                <Badge variant="destructive" className="ml-1.5 h-4 min-w-4 px-1 text-[10px]">
                  {operationUnreadCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="system" className="flex-1 text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none rounded-sm">
              Sistema
              {systemUnreadCount > 0 && (
                <Badge variant="destructive" className="ml-1.5 h-4 min-w-4 px-1 text-[10px]">
                  {systemUnreadCount}
                </Badge>
              )}
            </TabsTrigger>
            {mostrarIntegracoes && (
              <TabsTrigger value="integration" className="flex-1 gap-1 text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none rounded-sm">
                {/* Mesmo alerta da aba Divergências do OEM, de propósito: é o mesmo
                    assunto e tem que ter a mesma cara. O halo só existe aqui dentro
                    — este painel só é montado com o sino aberto, então ele pisca
                    enquanto a pessoa está olhando e não fica batendo sozinho no
                    canto da tela o dia inteiro. `motion-safe` respeita quem desligou
                    animação no sistema; para essas, o triângulo âmbar continua de pé. */}
                {integrationUnreadCount > 0 && (
                  <span className="relative flex h-3.5 w-3.5 items-center justify-center" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400/50 motion-safe:animate-ping" />
                    <AlertTriangle className="relative h-3.5 w-3.5 text-amber-500 dark:text-amber-400" />
                  </span>
                )}
                Integrações
                {integrationUnreadCount > 0 && (
                  <Badge variant="destructive" className="h-4 min-w-4 px-1 text-[10px]">
                    {integrationUnreadCount}
                  </Badge>
                )}
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="operation" className="m-0 mt-0">
            {renderList(operationNotifications, false)}
          </TabsContent>
          <TabsContent value="system" className="m-0 mt-0">
            {renderList(systemNotifications, true)}
          </TabsContent>
          {mostrarIntegracoes && (
            <TabsContent value="integration" className="m-0 mt-0">
              {renderList(
                integrationNotifications,
                true,
                "Nenhuma fila travada. Omie e OEM estão em dia.",
              )}
            </TabsContent>
          )}
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
