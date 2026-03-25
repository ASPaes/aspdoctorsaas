import { useEffect, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NumericInput } from "@/components/ui/numeric-input";
import { Badge } from "@/components/ui/badge";
import { Save, Loader2, Clock, Bot, Phone, X, Plus } from "lucide-react";
import { normalizeBRPhone, formatBRPhone, maskBRPhoneLive } from "@/lib/phoneBR";

// ─── Types ───────────────────────────────────────────────────────
interface DaySchedule {
  active: boolean;
  start: string;
  end: string;
}

type BusinessHours = Record<string, DaySchedule>;

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_LABELS: Record<string, string> = {
  mon: "Segunda", tue: "Terça", wed: "Quarta", thu: "Quinta",
  fri: "Sexta", sat: "Sábado", sun: "Domingo",
};

const DEFAULT_DAY: DaySchedule = { active: false, start: "08:00", end: "18:00" };

const TIMEZONES = [
  "America/Sao_Paulo", "America/Manaus", "America/Belem", "America/Bahia",
  "America/Fortaleza", "America/Recife", "America/Cuiaba", "America/Porto_Velho",
  "America/Rio_Branco", "America/Noronha",
];

// ─── Helpers ─────────────────────────────────────────────────────
function parseBusinessHours(raw: unknown): BusinessHours {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const result: BusinessHours = {};
  for (const key of DAY_KEYS) {
    const day = obj[key];
    if (day && typeof day === "object") {
      const d = day as Record<string, unknown>;
      result[key] = {
        active: !!d.active,
        start: typeof d.start === "string" ? d.start : "08:00",
        end: typeof d.end === "string" ? d.end : "18:00",
      };
    } else {
      result[key] = { ...DEFAULT_DAY };
    }
  }
  return result;
}

function parseKeywords(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((k) => typeof k === "string" && k.trim());
  return [];
}

// ─── Hook: fetch config row ─────────────────────────────────────
function useConfigRow() {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery({
    queryKey: ["configuracoes-horario", tid],
    enabled: !!tid,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("configuracoes")
        .select(
          "business_hours_enabled, business_hours, business_hours_timezone, business_hours_message, " +
          "business_hours_ai_enabled, business_hours_ai_prompt, " +
          "oncall_phone_number, oncall_message_template, oncall_escalation_window_minutes, " +
          "oncall_min_customer_messages, oncall_min_elapsed_seconds, oncall_repeat_cooldown_minutes, " +
          "oncall_urgency_keywords"
        )
        .eq("tenant_id", tid!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

// ─── Mutation helper ─────────────────────────────────────────────
function useSectionSave(sectionLabel: string) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { toast } = useToast();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { error } = await supabase
        .from("configuracoes")
        .update(payload as any)
        .eq("tenant_id", tid!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["configuracoes-horario", tid] });
      qc.invalidateQueries({ queryKey: ["support-config", tid] });
      toast({ title: `${sectionLabel} salvo!`, description: "Configurações atualizadas." });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    },
  });
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function HorarioPlantaoTab() {
  const { data: config, isLoading } = useConfigRow();

  // ── Section A: Business Hours ──
  const [bhEnabled, setBhEnabled] = useState(false);
  const [bhTimezone, setBhTimezone] = useState("America/Sao_Paulo");
  const [bhSchedule, setBhSchedule] = useState<BusinessHours>(() => {
    const h: BusinessHours = {};
    DAY_KEYS.forEach((k) => (h[k] = { ...DEFAULT_DAY }));
    // Default weekdays active
    ["mon", "tue", "wed", "thu", "fri"].forEach((d) => (h[d].active = true));
    return h;
  });
  const [bhMessage, setBhMessage] = useState("");

  // ── Section B: AI off-hours ──
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");

  // ── Section C: On-call ──
  const [ocPhoneDisplay, setOcPhoneDisplay] = useState("");
  const [ocTemplate, setOcTemplate] = useState("");
  const [ocWindowMin, setOcWindowMin] = useState(30);
  const [ocMinMsgs, setOcMinMsgs] = useState(3);
  const [ocMinElapsed, setOcMinElapsed] = useState(60);
  const [ocCooldown, setOcCooldown] = useState(360);
  const [ocKeywords, setOcKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState("");

  // Hydrate from DB
  useEffect(() => {
    if (!config) return;
    setBhEnabled(!!config.business_hours_enabled);
    setBhTimezone(config.business_hours_timezone || "America/Sao_Paulo");
    setBhSchedule(parseBusinessHours(config.business_hours));
    setBhMessage(config.business_hours_message || "");
    setAiEnabled(!!config.business_hours_ai_enabled);
    setAiPrompt(config.business_hours_ai_prompt || "");
    setOcPhoneDisplay(config.oncall_phone_number ? formatBRPhone(config.oncall_phone_number) : "");
    setOcTemplate(config.oncall_message_template || "");
    setOcWindowMin(config.oncall_escalation_window_minutes ?? 30);
    setOcMinMsgs(config.oncall_min_customer_messages ?? 3);
    setOcMinElapsed(config.oncall_min_elapsed_seconds ?? 60);
    setOcCooldown(config.oncall_repeat_cooldown_minutes ?? 360);
    setOcKeywords(parseKeywords(config.oncall_urgency_keywords));
  }, [config]);

  // ── Mutations ──
  const saveBH = useSectionSave("Horário de Atendimento");
  const saveAI = useSectionSave("IA fora do horário");
  const saveOC = useSectionSave("Plantão");

  // ── Day schedule helpers ──
  const updateDay = useCallback((day: string, field: keyof DaySchedule, value: unknown) => {
    setBhSchedule((prev) => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }));
  }, []);

  // ── Keyword helpers ──
  const addKeyword = useCallback(() => {
    const kw = newKeyword.trim().toLowerCase();
    if (!kw) return;
    setOcKeywords((prev) => (prev.includes(kw) ? prev : [...prev, kw]));
    setNewKeyword("");
  }, [newKeyword]);

  const removeKeyword = useCallback((kw: string) => {
    setOcKeywords((prev) => prev.filter((k) => k !== kw));
  }, []);

  // ── Save handlers ──
  const handleSaveBH = () => {
    saveBH.mutate({
      business_hours_enabled: bhEnabled,
      business_hours_timezone: bhTimezone,
      business_hours: bhSchedule,
      business_hours_message: bhMessage || null,
    });
  };

  const handleSaveAI = () => {
    saveAI.mutate({
      business_hours_ai_enabled: aiEnabled,
      business_hours_ai_prompt: aiPrompt || null,
    });
  };

  const handleSaveOC = () => {
    const phoneDigits = ocPhoneDisplay.replace(/\D/g, "") || null;
    saveOC.mutate({
      oncall_phone_number: phoneDigits,
      oncall_message_template: ocTemplate || null,
      oncall_escalation_window_minutes: ocWindowMin,
      oncall_min_customer_messages: ocMinMsgs,
      oncall_min_elapsed_seconds: ocMinElapsed,
      oncall_repeat_cooldown_minutes: ocCooldown,
      oncall_urgency_keywords: ocKeywords,
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 rounded bg-muted animate-pulse" />
        <div className="h-64 w-full rounded bg-muted animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <Accordion type="multiple" defaultValue={["horario", "ai", "plantao"]} className="space-y-4">
        {/* ════════════════════════════════════════════════════════════ */}
        {/* SECTION A: BUSINESS HOURS                                  */}
        {/* ════════════════════════════════════════════════════════════ */}
        <AccordionItem value="horario" className="border rounded-lg">
          <AccordionTrigger className="px-4 hover:no-underline">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              <span className="font-semibold text-base">Horário de Atendimento</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 space-y-5">
            {/* Toggle */}
            <div className="flex items-center gap-3">
              <Switch checked={bhEnabled} onCheckedChange={setBhEnabled} id="bh-enabled" />
              <Label htmlFor="bh-enabled">Ativar controle de horário de atendimento</Label>
            </div>

            {bhEnabled && (
              <>
                {/* Timezone */}
                <div className="space-y-1.5">
                  <Label>Fuso horário</Label>
                  <Select value={bhTimezone} onValueChange={setBhTimezone}>
                    <SelectTrigger className="w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map((tz) => (
                        <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Day grid */}
                <div className="space-y-2">
                  <Label>Grade semanal</Label>
                  <div className="rounded-lg border divide-y">
                    {DAY_KEYS.map((day) => {
                      const s = bhSchedule[day];
                      return (
                        <div key={day} className="flex items-center gap-3 px-3 py-2">
                          <Checkbox
                            checked={s.active}
                            onCheckedChange={(v) => updateDay(day, "active", !!v)}
                            id={`day-${day}`}
                          />
                          <Label htmlFor={`day-${day}`} className="w-20 text-sm font-medium">
                            {DAY_LABELS[day]}
                          </Label>
                          <Input
                            type="time"
                            value={s.start}
                            onChange={(e) => updateDay(day, "start", e.target.value)}
                            className="w-28"
                            disabled={!s.active}
                          />
                          <span className="text-muted-foreground text-sm">às</span>
                          <Input
                            type="time"
                            value={s.end}
                            onChange={(e) => updateDay(day, "end", e.target.value)}
                            className="w-28"
                            disabled={!s.active}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Message */}
                <div className="space-y-1.5">
                  <Label>Mensagem fora do horário</Label>
                  <Textarea
                    value={bhMessage}
                    onChange={(e) => setBhMessage(e.target.value)}
                    rows={3}
                    placeholder="Olá! Nosso horário é das {{start}} às {{end}}..."
                  />
                  <p className="text-xs text-muted-foreground">
                    Placeholders disponíveis: <code className="text-xs">{"{{start}}"}</code> e <code className="text-xs">{"{{end}}"}</code>
                  </p>
                </div>
              </>
            )}

            <Button onClick={handleSaveBH} disabled={saveBH.isPending} size="sm">
              {saveBH.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Salvar Horário
            </Button>
          </AccordionContent>
        </AccordionItem>

        {/* ════════════════════════════════════════════════════════════ */}
        {/* SECTION B: AI OFF-HOURS                                    */}
        {/* ════════════════════════════════════════════════════════════ */}
        <AccordionItem value="ai" className="border rounded-lg">
          <AccordionTrigger className="px-4 hover:no-underline">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              <span className="font-semibold text-base">IA fora do Horário</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 space-y-5">
            <div className="flex items-center gap-3">
              <Switch
                checked={aiEnabled}
                onCheckedChange={setAiEnabled}
                disabled={!bhEnabled}
                id="ai-enabled"
              />
              <Label htmlFor="ai-enabled" className={!bhEnabled ? "text-muted-foreground" : ""}>
                Ativar respostas automáticas com IA fora do horário
              </Label>
            </div>
            {!bhEnabled && (
              <p className="text-xs text-muted-foreground">
                Ative o controle de horário de atendimento primeiro.
              </p>
            )}

            {aiEnabled && bhEnabled && (
              <div className="space-y-1.5">
                <Label>Prompt da IA</Label>
                <Textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  rows={5}
                  placeholder="Você é um assistente que responde fora do horário comercial..."
                />
                <p className="text-xs text-muted-foreground">
                  Este prompt será usado pela IA para responder mensagens fora do horário, com base no histórico da conversa e na Base de Conhecimento.
                </p>
              </div>
            )}

            <Button onClick={handleSaveAI} disabled={saveAI.isPending} size="sm">
              {saveAI.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Salvar IA
            </Button>
          </AccordionContent>
        </AccordionItem>

        {/* ════════════════════════════════════════════════════════════ */}
        {/* SECTION C: ON-CALL                                         */}
        {/* ════════════════════════════════════════════════════════════ */}
        <AccordionItem value="plantao" className="border rounded-lg">
          <AccordionTrigger className="px-4 hover:no-underline">
            <div className="flex items-center gap-2">
              <Phone className="h-5 w-5 text-primary" />
              <span className="font-semibold text-base">Plantão (Escalação por Insistência)</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 space-y-5">
            {/* Phone */}
            <div className="space-y-1.5">
              <Label>Telefone de plantão</Label>
              <Input
                value={ocPhoneDisplay}
                onChange={(e) => setOcPhoneDisplay(maskBRPhoneLive(e.target.value))}
                placeholder="+55 (00) 00000-0000"
                className="w-64"
              />
              <p className="text-xs text-muted-foreground">Número exibido ao cliente quando a escalação for acionada.</p>
            </div>

            {/* Template */}
            <div className="space-y-1.5">
              <Label>Mensagem de plantão</Label>
              <Textarea
                value={ocTemplate}
                onChange={(e) => setOcTemplate(e.target.value)}
                rows={2}
                placeholder="Entendi sua urgência. 📞 Ligue: {{oncall_phone}}"
              />
              <p className="text-xs text-muted-foreground">
                Placeholder: <code className="text-xs">{"{{oncall_phone}}"}</code>
              </p>
            </div>

            {/* Numeric configs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Janela de escalação (min)</Label>
                <NumericInput value={ocWindowMin} onChange={setOcWindowMin} placeholder="30" />
                <p className="text-xs text-muted-foreground">Período em que o sistema analisa insistência.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Mín. mensagens do cliente</Label>
                <NumericInput value={ocMinMsgs} onChange={setOcMinMsgs} placeholder="3" />
                <p className="text-xs text-muted-foreground">Qtd. mínima de mensagens para acionar.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Tempo mín. decorrido (seg)</Label>
                <NumericInput value={ocMinElapsed} onChange={setOcMinElapsed} placeholder="60" />
                <p className="text-xs text-muted-foreground">Segundos desde a 1ª mensagem.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Cooldown de repetição (min)</Label>
                <NumericInput value={ocCooldown} onChange={setOcCooldown} placeholder="360" />
                <p className="text-xs text-muted-foreground">Não reescalar antes desse intervalo.</p>
              </div>
            </div>

            {/* Keywords */}
            <div className="space-y-2">
              <Label>Palavras-chave de urgência</Label>
              <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2 border rounded-md bg-background">
                {ocKeywords.map((kw) => (
                  <Badge key={kw} variant="secondary" className="gap-1 pr-1">
                    {kw}
                    <button
                      type="button"
                      onClick={() => removeKeyword(kw)}
                      className="hover:text-destructive rounded-full"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {ocKeywords.length === 0 && (
                  <span className="text-xs text-muted-foreground">Nenhuma palavra-chave adicionada.</span>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  placeholder="Adicionar palavra-chave..."
                  className="flex-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); addKeyword(); }
                  }}
                />
                <Button type="button" variant="outline" size="sm" onClick={addKeyword}>
                  <Plus className="h-4 w-4 mr-1" />Adicionar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Termos que indicam urgência fora do horário. Usados para decidir se o plantão deve ser acionado.
              </p>
            </div>

            <Button onClick={handleSaveOC} disabled={saveOC.isPending} size="sm">
              {saveOC.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Salvar Plantão
            </Button>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
