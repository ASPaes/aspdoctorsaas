import { useEffect, useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NumericInput } from "@/components/ui/numeric-input";
import { Badge } from "@/components/ui/badge";
import { Save, Loader2, Clock, Bot, Phone, X, Plus } from "lucide-react";
import { formatBRPhone, maskBRPhoneLive } from "@/lib/phoneBR";
import BusinessHoursExceptionsSection from "./BusinessHoursExceptionsSection";
import BusinessHoursHolidayTemplateSection from "./BusinessHoursHolidayTemplateSection";
import {
  WeeklyScheduleGrid,
  DAY_KEYS,
  DEFAULT_SLOT,
  DEFAULT_DAY,
  parseBusinessHours,
  validateSchedule,
  cleanSchedule,
  type BusinessHours,
} from "./WeeklyScheduleGrid";

const TIMEZONES = [
  "America/Sao_Paulo", "America/Manaus", "America/Belem", "America/Bahia",
  "America/Fortaleza", "America/Recife", "America/Cuiaba", "America/Porto_Velho",
  "America/Rio_Branco", "America/Noronha",
];

// ─── Helpers ─────────────────────────────────────────────────────
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
          "business_hours_ai_enabled, business_hours_ai_prompt, business_hours_outside_prompt, " +
          "oncall_phone_number, oncall_message_template, oncall_escalation_window_minutes, " +
          "oncall_min_customer_messages, oncall_min_elapsed_seconds, oncall_repeat_cooldown_minutes, " +
          "oncall_urgency_keywords, " +
          "horario_comercial, horario_comercial_enabled"
        )
        .eq("tenant_id", tid!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as Record<string, unknown> | null;
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
  const { toast } = useToast();
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
  const [bhOutsidePrompt, setBhOutsidePrompt] = useState("");
  const [deptSlaMin, setDeptSlaMin] = useState<number | "">("");
  const [savingSla, setSavingSla] = useState(false);

  // ── Section A.1: Horário comercial (contrato) ──
  const [hcEnabled, setHcEnabled] = useState(false);
  const [hcSchedule, setHcSchedule] = useState<BusinessHours>(() => parseBusinessHours({}));

  // ── Contexto: Global vs Setor ──
  const [selectedContext, setSelectedContext] = useState<string>("global");

  // ── Re-hydration guard: only hydrate when context actually changes ──
  const lastHydratedContext = useRef<string | null>(null);

  // ── Departments query (for context selector) ──
  const { effectiveTenantId: deptTid } = useTenantFilter();
  const qcDept = useQueryClient();
  const { data: deptRows = [] } = useQuery({
    queryKey: ["dept-business-hours", deptTid],
    enabled: !!deptTid,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_departments" as any) as any)
        .select("id, name, business_hours_enabled, business_hours, business_hours_message, sla_frt_seconds, sort_order")
        .eq("tenant_id", deptTid!)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; name: string;
        business_hours_enabled: boolean | null;
        business_hours: unknown;
        business_hours_message: string | null;
        sla_frt_seconds: number | null;
        sort_order: number | null;
      }>;
    },
  });

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

  // Hydrate form fields based on selected context (global or department)
  useEffect(() => {
    if (selectedContext === "global") {
      if (!config) return;
      const c = config as Record<string, any>;
      setBhEnabled(!!c.business_hours_enabled);
      setBhTimezone((c.business_hours_timezone as string) || "America/Sao_Paulo");
      setBhSchedule(parseBusinessHours(c.business_hours));
      setBhMessage((c.business_hours_message as string) || "");
      setBhOutsidePrompt((c.business_hours_outside_prompt as string) || "");
    } else {
      // Department context
      const dept = deptRows.find((d) => d.id === selectedContext);
      if (!dept) return;
      const enabled = !!dept.business_hours_enabled;
      setBhEnabled(enabled);
      // Timezone is always global
      if (config) setBhTimezone(((config as Record<string, any>).business_hours_timezone as string) || "America/Sao_Paulo");
      if (enabled && dept.business_hours && Object.keys(dept.business_hours as object).length > 0) {
        setBhSchedule(parseBusinessHours(dept.business_hours));
      } else {
        // Initialize with weekdays active
        const fresh: BusinessHours = {};
        DAY_KEYS.forEach((k) => (fresh[k] = { active: false, slots: [{ ...DEFAULT_SLOT }] }));
        ["mon", "tue", "wed", "thu", "fri"].forEach((d) => (fresh[d].active = true));
        setBhSchedule(fresh);
      }
      setBhMessage((dept.business_hours_message as string) || "");
      setBhOutsidePrompt("");
      setDeptSlaMin(dept.sla_frt_seconds ? Math.round(dept.sla_frt_seconds / 60) : "");
    }
  }, [selectedContext, config, deptRows]);

  // Hydrate AI + On-call (always from global config, independent of context)
  useEffect(() => {
    if (!config) return;
    const c = config as Record<string, any>;
    setAiEnabled(!!c.business_hours_ai_enabled);
    setAiPrompt((c.business_hours_ai_prompt as string) || "");
    const phone = c.oncall_phone_number as string | null;
    setOcPhoneDisplay(phone ? formatBRPhone(phone) : "");
    setOcTemplate((c.oncall_message_template as string) || "");
    setOcWindowMin((c.oncall_escalation_window_minutes as number) ?? 30);
    setOcMinMsgs((c.oncall_min_customer_messages as number) ?? 3);
    setOcMinElapsed((c.oncall_min_elapsed_seconds as number) ?? 60);
    setOcCooldown((c.oncall_repeat_cooldown_minutes as number) ?? 360);
    setOcKeywords(parseKeywords(c.oncall_urgency_keywords));
    setHcEnabled(!!c.horario_comercial_enabled);
    setHcSchedule(parseBusinessHours(c.horario_comercial));
  }, [config]);

  // ── Mutations ──
  const saveBH = useSectionSave("Disponibilidade de atendimento");
  const saveAI = useSectionSave("IA fora do horário");
  const saveOC = useSectionSave("Escalonamento de plantão");
  const saveHC = useSectionSave("Horário comercial");

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
  const handleSaveBH = async () => {
    const err = validateSchedule(bhSchedule);
    if (err) {
      toast({ title: "Erro de validação", description: err, variant: "destructive" });
      return;
    }
    const cleaned = cleanSchedule(bhSchedule);

    if (selectedContext === "global") {
      saveBH.mutate({
        business_hours_enabled: bhEnabled,
        business_hours_timezone: bhTimezone,
        business_hours: cleaned,
        business_hours_message: bhMessage || null,
        business_hours_outside_prompt: bhOutsidePrompt || null,
      });
    } else {
      // Save to department
      try {
        const { error } = await (supabase.from("support_departments" as any) as any)
          .update({
            business_hours_enabled: bhEnabled,
            business_hours: cleaned,
            business_hours_message: bhMessage || null,
          })
          .eq("id", selectedContext);
        if (error) throw error;
        qcDept.invalidateQueries({ queryKey: ["dept-business-hours", deptTid] });
        const deptName = deptRows.find((d) => d.id === selectedContext)?.name || "Setor";
        toast({ title: `Horário do setor ${deptName} salvo!` });
      } catch (err: any) {
        toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
      }
    }
  };

  const handleSaveDeptSla = async () => {
    if (selectedContext === "global") return;
    setSavingSla(true);
    try {
      const secs = deptSlaMin === "" ? null : Math.round(Number(deptSlaMin) * 60);
      const { error } = await (supabase.from("support_departments" as any) as any)
        .update({ sla_frt_seconds: secs })
        .eq("id", selectedContext);
      if (error) throw error;
      qcDept.invalidateQueries({ queryKey: ["dept-business-hours", deptTid] });
      const deptName = deptRows.find((d) => d.id === selectedContext)?.name || "Setor";
      toast({ title: `Alvo de SLA do setor ${deptName} salvo!` });
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    } finally {
      setSavingSla(false);
    }
  };

  const handleSaveAI = () => {
    saveAI.mutate({
      business_hours_ai_enabled: aiEnabled,
      business_hours_ai_prompt: aiPrompt || null,
    });
  };

  const handleSaveHC = async () => {
    const err = validateSchedule(hcSchedule);
    if (err) {
      toast({ title: "Erro de validação", description: err, variant: "destructive" });
      return;
    }
    saveHC.mutate({
      horario_comercial_enabled: hcEnabled,
      horario_comercial: cleanSchedule(hcSchedule),
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
      <Accordion type="multiple" defaultValue={["horario", "horario-comercial", "feriados", "ai", "plantao"]} className="space-y-4">
        {/* ════════════════════════════════════════════════════════════ */}
        {/* SECTION A: BUSINESS HOURS                                  */}
        {/* ════════════════════════════════════════════════════════════ */}
        <AccordionItem value="horario" className="border rounded-lg">
          <AccordionTrigger className="px-4 hover:no-underline">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              <span className="font-semibold text-base">Disponibilidade de atendimento</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 space-y-5">
            {/* Seletor de contexto: Global vs Setor */}
            {deptRows.length > 0 && (
              <div className="space-y-1.5">
                <Label>Configurar horário para</Label>
                <Select value={selectedContext} onValueChange={setSelectedContext}>
                  <SelectTrigger className="w-72">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">
                      🌐 Global (padrão)
                    </SelectItem>
                    {deptRows.map((dept) => (
                      <SelectItem key={dept.id} value={dept.id}>
                        📋 {dept.name} {dept.business_hours_enabled ? "✦" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {selectedContext === "global"
                    ? "Horário padrão usado por setores sem configuração própria."
                    : `Horário específico para o setor ${deptRows.find((d) => d.id === selectedContext)?.name || ""}.`}
                </p>
              </div>
            )}

            {selectedContext !== "global" && (
              <div className="space-y-1.5 rounded-lg border p-3">
                <Label>Alvo de SLA de 1ª resposta (minutos)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    value={deptSlaMin}
                    onChange={(e) => setDeptSlaMin(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="herda global"
                    className="w-36"
                  />
                  <Button onClick={handleSaveDeptSla} disabled={savingSla} size="sm" variant="outline">
                    {savingSla ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                    Salvar alvo
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Deixe vazio para herdar o alvo global do dashboard. Afeta a tabela "% dentro do SLA por departamento".
                </p>
              </div>
            )}

            {/* Toggle */}
            <div className="flex items-center gap-3">
              <Switch checked={bhEnabled} onCheckedChange={setBhEnabled} id="bh-enabled" />
              <Label htmlFor="bh-enabled">
                {selectedContext === "global"
                  ? "Ativar controle de horário de atendimento"
                  : "Ativar horário personalizado para este setor"}
              </Label>
            </div>

            {selectedContext !== "global" && !bhEnabled && (
              <div className="flex items-start gap-3 p-3 rounded-lg border border-blue-500/20 bg-blue-500/5">
                <span className="text-blue-400 mt-0.5 text-lg">ℹ️</span>
                <div>
                  <p className="text-sm text-blue-300">
                    Este setor está usando o horário global.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Ative o controle acima para definir um horário personalizado para este setor.
                  </p>
                </div>
              </div>
            )}

            {bhEnabled && (
              <>
                {/* Timezone (only global) */}
                {selectedContext === "global" && (
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
                )}

                {/* Day grid */}
                <div className="space-y-2">
                  <Label>Grade semanal</Label>
                  <WeeklyScheduleGrid value={bhSchedule} onChange={setBhSchedule} idPrefix="bh" />
                  <BusinessHoursHolidayTemplateSection />
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

                {/* Outside hours AI prompt (only global) */}
                {selectedContext === "global" && (
                  <div className="space-y-1.5">
                    <Label>Prompt da IA para mensagem fora do horário</Label>
                    <Textarea
                      value={bhOutsidePrompt}
                      onChange={(e) => setBhOutsidePrompt(e.target.value)}
                      rows={4}
                      placeholder="Ex: Você é um atendente virtual simpático. Escreva uma mensagem curta e amigável informando que estamos fora do horário. Use a saudação correta pelo horário ({{greeting}}). Horário: {{slots}}. Retorno: {{next_start}}."
                    />
                    <p className="text-xs text-muted-foreground">
                      Usado quando o tenant possui IA configurada. Deixe em branco para usar o prompt padrão.
                      Variáveis disponíveis: <code className="text-xs">{"{{greeting}}"}</code>, <code className="text-xs">{"{{slots}}"}</code>, <code className="text-xs">{"{{next_start}}"}</code>, <code className="text-xs">{"{{slot1_start}}"}</code>, <code className="text-xs">{"{{slot1_end}}"}</code>, <code className="text-xs">{"{{slot2_start}}"}</code>, <code className="text-xs">{"{{slot2_end}}"}</code>
                    </p>
                  </div>
                )}
              </>
            )}

            <div className="flex items-center gap-2">
              <Button onClick={handleSaveBH} disabled={saveBH.isPending} size="sm">
                {saveBH.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                {selectedContext === "global" ? "Salvar Horário" : `Salvar Horário - ${deptRows.find((d) => d.id === selectedContext)?.name || "Setor"}`}
              </Button>
              {selectedContext !== "global" && bhEnabled && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={async () => {
                    try {
                      const { error } = await (supabase.from("support_departments" as any) as any)
                        .update({
                          business_hours_enabled: false,
                          business_hours: {},
                          business_hours_message: null,
                        })
                        .eq("id", selectedContext);
                      if (error) throw error;
                      setBhEnabled(false);
                      qcDept.invalidateQueries({ queryKey: ["dept-business-hours", deptTid] });
                      const deptName = deptRows.find((d) => d.id === selectedContext)?.name || "Setor";
                      toast({ title: `Setor ${deptName} restaurado para horário global.` });
                    } catch (err: any) {
                      toast({ title: "Erro ao restaurar", description: err.message, variant: "destructive" });
                    }
                  }}
                >
                  <Clock className="h-4 w-4 mr-1" />
                  Restaurar horário global
                </Button>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ════════════════════════════════════════════════════════════ */}
        {/* SECTION A.1: HORÁRIO COMERCIAL (CONTRATO)                  */}
        {/* ════════════════════════════════════════════════════════════ */}
        <AccordionItem value="horario-comercial" className="border rounded-lg">
          <AccordionTrigger className="px-4 hover:no-underline">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              <span className="font-semibold text-base">Horário comercial</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 space-y-5">
            {/* Toggle */}
            <div className="flex items-center gap-3">
              <Switch checked={hcEnabled} onCheckedChange={setHcEnabled} id="hc-enabled" />
              <Label htmlFor="hc-enabled">Ativar horário comercial</Label>
            </div>

            <p className="text-xs text-muted-foreground">
              Define o que está incluso no contrato. Todo atendimento trabalhado fora desta
              janela conta como plantão nos relatórios. Vale para a empresa inteira — não há
              horário comercial por setor. Sem esta configuração ativa, o plantão continua
              sendo calculado pela disponibilidade acima.
            </p>

            {!hcEnabled && (
              <div className="flex items-start gap-3 p-3 rounded-lg border border-blue-500/20 bg-blue-500/5">
                <span className="text-blue-400 mt-0.5 text-lg">ℹ️</span>
                <p className="text-sm text-blue-300">
                  Enquanto estiver desligado, o relatório usa a disponibilidade de atendimento —
                  que costuma ser mais larga que o horário comercial e faz o plantão aparecer menos
                  do que aconteceu.
                </p>
              </div>
            )}

            {hcEnabled && (
              <div className="space-y-2">
                <Label>Grade semanal</Label>
                <WeeklyScheduleGrid value={hcSchedule} onChange={setHcSchedule} idPrefix="hc" />
              </div>
            )}

            <Button onClick={handleSaveHC} disabled={saveHC.isPending} size="sm">
              {saveHC.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Salvar Horário comercial
            </Button>
          </AccordionContent>
        </AccordionItem>

        {/* ════════════════════════════════════════════════════════════ */}
        {/* SECTION A.2: HOLIDAYS / EXCEPTIONS                         */}
        {/* ════════════════════════════════════════════════════════════ */}
        <BusinessHoursExceptionsSection />


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
              <span className="font-semibold text-base">Escalonamento de plantão (Escalação por Insistência)</span>
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
              Salvar Escalonamento
            </Button>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
