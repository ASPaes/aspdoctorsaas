import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Bell, Volume2, Loader2 } from "lucide-react";

const SOUND_URL =
  "https://vbngjzovjhkmietztffo.supabase.co/storage/v1/object/public/notification-sounds/padrao.mp3";

type AlertMode = "off" | "silent" | "tick" | "full";

interface Settings {
  master_enabled: boolean;
  sound_enabled: boolean;
  visual_enabled: boolean;
  push_enabled: boolean;
  volume: number;
  dnd_enabled: boolean;
  dnd_start: string | null;
  dnd_end: string | null;
  dnd_days: number[];
  alert_in_conversation: AlertMode;
  alert_other_conversation: AlertMode;
  alert_other_module: AlertMode;
  notification_scope: string;
}

const DEFAULTS: Settings = {
  master_enabled: true,
  sound_enabled: true,
  visual_enabled: true,
  push_enabled: true,
  volume: 70,
  dnd_enabled: false,
  dnd_start: null,
  dnd_end: null,
  dnd_days: [],
  alert_in_conversation: "tick",
  alert_other_conversation: "full",
  alert_other_module: "full",
  notification_scope: "all",
};

const DAYS = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
];

function formatMutedUntil(iso: string | null): string {
  if (!iso) return "Para sempre";
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `Até ${dd}/${mm} ${hh}:${mi}`;
}

export default function ConfiguracoesNotificacoes() {
  const { user } = useAuth();
  const uid = user?.id;
  const queryClient = useQueryClient();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const initializing = useRef(true);

  // Load settings
  const { data: loadedData, isLoading } = useQuery({
    queryKey: ["notification-settings-page", uid],
    enabled: !!uid,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "resolve_user_notification_settings" as any,
        { p_user_id: uid! }
      );
      if (error) throw error;
      return (data as any) ?? {};
    },
  });

  useEffect(() => {
    if (loadedData && !loaded) {
      const merged: Settings = {
        ...DEFAULTS,
        ...loadedData,
        dnd_days: Array.isArray(loadedData.dnd_days) ? loadedData.dnd_days : [],
      };
      setSettings(merged);
      setLoaded(true);
      // allow auto-save after first paint
      setTimeout(() => {
        initializing.current = false;
      }, 100);
    }
  }, [loadedData, loaded]);

  // Auto-save with debounce
  useEffect(() => {
    if (!uid || !loaded || initializing.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const payload = {
        master_enabled: settings.master_enabled,
        sound_enabled: settings.sound_enabled,
        visual_notifications_enabled: settings.visual_enabled,
        push_enabled: settings.push_enabled,
        volume: settings.volume,
        dnd_enabled: settings.dnd_enabled,
        dnd_start: settings.dnd_start,
        dnd_end: settings.dnd_end,
        dnd_days: settings.dnd_days,
        alert_in_conversation: settings.alert_in_conversation,
        alert_other_conversation: settings.alert_other_conversation,
        alert_other_module: settings.alert_other_module,
        updated_at: new Date().toISOString(),
      };

      // Try update; if no row, insert.
      const { data: existing } = await supabase
        .from("user_preferences" as any)
        .select("id")
        .eq("user_id", uid)
        .maybeSingle();

      let error;
      if (existing) {
        ({ error } = await supabase
          .from("user_preferences" as any)
          .update(payload)
          .eq("user_id", uid));
      } else {
        ({ error } = await supabase
          .from("user_preferences" as any)
          .insert({ user_id: uid, ...payload } as any));
      }

      if (error) {
        toast.error("Erro ao salvar preferências");
        return;
      }
      toast.success("Preferências salvas", { duration: 1500 });
      queryClient.invalidateQueries({ queryKey: ["notification-settings", uid] });
      queryClient.invalidateQueries({ queryKey: ["notification-settings-page", uid] });
    }, 500);

    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, uid, loaded]);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
  };

  const playTestSound = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(SOUND_URL);
    }
    audioRef.current.volume = Math.max(0, Math.min(1, settings.volume / 100));
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => {
      toast.error("Não foi possível reproduzir o som");
    });
  };

  // Muted conversations list
  const { data: mutedList, isLoading: mutedLoading } = useQuery({
    queryKey: ["muted-conversations", uid],
    enabled: !!uid,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_conversation_mute" as any)
        .select(
          `conversation_id, muted_until, conversation:whatsapp_conversations(id, contact:whatsapp_contacts(name, phone_number))`
        )
        .eq("user_id", uid!);
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });

  const handleUnmute = async (conversationId: string) => {
    const { error } = await supabase.rpc("unmute_conversation" as any, {
      p_conversation_id: conversationId,
    });
    if (error) {
      toast.error("Erro ao desmutar");
      return;
    }
    toast.success("Notificações reativadas");
    queryClient.invalidateQueries({ queryKey: ["muted-conversations", uid] });
    queryClient.invalidateQueries({ queryKey: ["conversation-mute", conversationId, uid] });
  };

  const toggleDay = (day: number) => {
    const has = settings.dnd_days.includes(day);
    const next = has
      ? settings.dnd_days.filter((d) => d !== day)
      : [...settings.dnd_days, day].sort();
    update("dnd_days", next);
  };

  if (isLoading || !loaded) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container max-w-3xl mx-auto py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Bell className="h-6 w-6" /> Notificações
        </h1>
        <p className="text-muted-foreground text-sm">
          Configure como você recebe alertas de novas mensagens
        </p>
      </header>

      {/* Geral */}
      <Card>
        <CardHeader>
          <CardTitle>Geral</CardTitle>
          <CardDescription>Controles principais de notificação</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <Label htmlFor="master_enabled" className="flex-1">Ativar notificações</Label>
            <Switch
              id="master_enabled"
              checked={settings.master_enabled}
              onCheckedChange={(v) => update("master_enabled", v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="sound_enabled" className="flex-1">Som</Label>
            <Switch
              id="sound_enabled"
              checked={settings.sound_enabled}
              onCheckedChange={(v) => update("sound_enabled", v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="visual_enabled" className="flex-1">
              Notificações visuais (toast e badge)
            </Label>
            <Switch
              id="visual_enabled"
              checked={settings.visual_enabled}
              onCheckedChange={(v) => update("visual_enabled", v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="push_enabled" className="flex-1">
              Notificação do navegador quando aba não está em foco
            </Label>
            <Switch
              id="push_enabled"
              checked={settings.push_enabled}
              onCheckedChange={(v) => update("push_enabled", v)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2">
                <Volume2 className="h-4 w-4" /> Volume
              </Label>
              <span className="text-sm text-muted-foreground tabular-nums">
                {settings.volume}%
              </span>
            </div>
            <Slider
              value={[settings.volume]}
              min={0}
              max={100}
              step={1}
              onValueChange={(v) => update("volume", v[0])}
            />
            <Button variant="outline" size="sm" onClick={playTestSound}>
              Testar som
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Não perturbe */}
      <Card>
        <CardHeader>
          <CardTitle>Não perturbe</CardTitle>
          <CardDescription>
            Suprime alertas em horários ou dias específicos
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <Label htmlFor="dnd_enabled" className="flex-1">
              Ativar Não Perturbe em horários específicos
            </Label>
            <Switch
              id="dnd_enabled"
              checked={settings.dnd_enabled}
              onCheckedChange={(v) => update("dnd_enabled", v)}
            />
          </div>

          {settings.dnd_enabled && (
            <div className="space-y-4 pl-2 border-l-2 border-muted">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="dnd_start">Início</Label>
                  <Input
                    id="dnd_start"
                    type="time"
                    value={settings.dnd_start ?? ""}
                    onChange={(e) => update("dnd_start", e.target.value || null)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dnd_end">Fim</Label>
                  <Input
                    id="dnd_end"
                    type="time"
                    value={settings.dnd_end ?? ""}
                    onChange={(e) => update("dnd_end", e.target.value || null)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Durante este período, alertas sonoros e visuais serão suprimidos.
                As notificações continuam aparecendo no sino para você ver depois.
              </p>
              <div className="space-y-2">
                <Label>Dias da semana</Label>
                <div className="flex flex-wrap gap-3">
                  {DAYS.map((d) => (
                    <label
                      key={d.value}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <Checkbox
                        checked={settings.dnd_days.includes(d.value)}
                        onCheckedChange={() => toggleDay(d.value)}
                      />
                      {d.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Comportamento por situação */}
      <Card>
        <CardHeader>
          <CardTitle>Comportamento por situação</CardTitle>
          <CardDescription>
            Defina como o alerta se comporta dependendo de onde você está no sistema
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Quando estou na própria conversa que recebeu mensagem</Label>
            <Select
              value={settings.alert_in_conversation}
              onValueChange={(v) => update("alert_in_conversation", v as AlertMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Desligado</SelectItem>
                <SelectItem value="tick">Som sutil sem aviso visual</SelectItem>
                <SelectItem value="full">Som e aviso visual</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Quando estou em outra conversa do chat</Label>
            <Select
              value={settings.alert_other_conversation}
              onValueChange={(v) =>
                update("alert_other_conversation", v as AlertMode)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Desligado</SelectItem>
                <SelectItem value="silent">Apenas aviso visual sem som</SelectItem>
                <SelectItem value="full">Som e aviso visual</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Quando estou em outra área do sistema</Label>
            <Select
              value={settings.alert_other_module}
              onValueChange={(v) => update("alert_other_module", v as AlertMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Desligado</SelectItem>
                <SelectItem value="silent">Apenas aviso visual sem som</SelectItem>
                <SelectItem value="full">Som e aviso visual</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Conversas silenciadas */}
      <Card>
        <CardHeader>
          <CardTitle>Conversas silenciadas</CardTitle>
          <CardDescription>
            Conversas com notificações suprimidas individualmente
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mutedLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !mutedList || mutedList.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Você não tem conversas silenciadas.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {mutedList.map((row: any) => {
                const contact = row.conversation?.contact;
                const name =
                  contact?.name || contact?.phone_number || "Sem nome";
                return (
                  <li
                    key={row.conversation_id}
                    className="flex items-center justify-between py-3 gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatMutedUntil(row.muted_until)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUnmute(row.conversation_id)}
                    >
                      Desmutar
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
