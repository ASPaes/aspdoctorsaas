import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAutomationLookups } from "@/components/whatsapp/hooks/useAutomationLookups";
import type {
  AutomationAction,
  AutomationRule,
  AutomationTrigger,
} from "@/components/whatsapp/hooks/useAutomationRules";

const QUALQUER = "qualquer";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Regra em edição, ou uma cópia sem `id` quando é duplicação. */
  rule?: Partial<AutomationRule> | null;
  onSave: (payload: Partial<AutomationRule> & { id?: string }) => void;
  salvando?: boolean;
}

/** `datetime-local` fala no fuso do navegador, que é o da operação. */
function paraInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function paraIso(valor: string): string | null {
  if (!valor) return null;
  const d = new Date(valor);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function hoje(hora: number, minuto: number, somarDias = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + somarDias);
  d.setHours(hora, minuto, 0, 0);
  return paraInput(d.toISOString());
}

/** Fim do expediente da operação: seg a sex, 07:30 às 19:00. */
function fimDoDiaUtil(): string {
  const agora = new Date();
  return agora.getHours() >= 19 ? hoje(23, 59) : hoje(19, 0);
}

function proximaSexta(): string {
  const agora = new Date();
  const diasAteSexta = (5 - agora.getDay() + 7) % 7;
  return hoje(19, 0, diasAteSexta);
}

export function AutomationRuleDialog({ open, onOpenChange, rule, onSave, salvando }: Props) {
  const { setores, pessoas, canais } = useAutomationLookups();

  const [nome, setNome] = useState("");
  const [gatilho, setGatilho] = useState<AutomationTrigger>("chat_inbound");
  const [carencia, setCarencia] = useState("30");
  const [setorCond, setSetorCond] = useState(QUALQUER);
  const [pessoaCond, setPessoaCond] = useState(QUALQUER);
  const [canalCond, setCanalCond] = useState(QUALQUER);
  const [acao, setAcao] = useState<AutomationAction>("route_to_department");
  const [setorDestino, setSetorDestino] = useState("");
  const [pessoaDestino, setPessoaDestino] = useState("");
  const [temporaria, setTemporaria] = useState(true);
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [prioridade, setPrioridade] = useState("10");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErro(null);
    setNome(rule?.name ?? "");
    setGatilho((rule?.trigger_event as AutomationTrigger) ?? "chat_inbound");
    setCarencia(String(rule?.grace_minutes ?? 30));
    setSetorCond(rule?.match_department_id ?? QUALQUER);
    setPessoaCond(rule?.match_agent_id ?? QUALQUER);
    setCanalCond(rule?.match_instance_id ?? QUALQUER);
    setAcao((rule?.action as AutomationAction) ?? "route_to_department");
    setSetorDestino(rule?.target_department_id ?? "");
    setPessoaDestino(rule?.target_agent_id ?? "");
    const temJanela = Boolean(rule?.starts_at || rule?.ends_at);
    setTemporaria(rule ? temJanela : true);
    setInicio(paraInput(rule?.starts_at));
    setFim(paraInput(rule?.ends_at));
    setPrioridade(String(rule?.priority ?? 10));
  }, [open, rule]);

  const semAgente = gatilho === "no_agent_available";

  const resumo = useMemo(() => {
    const nomeSetorCond = setores.find((s) => s.id === setorCond)?.name;
    const destinoTexto =
      acao === "route_to_department"
        ? `a fila do setor ${setores.find((s) => s.id === setorDestino)?.name ?? "(escolha)"}`
        : `${pessoas.find((p) => p.user_id === pessoaDestino)?.nome ?? "(escolha)"}`;

    if (gatilho === "no_agent_available") {
      if (setorCond === QUALQUER || !nomeSetorCond) return null;
      const canal =
        canalCond !== QUALQUER ? ` pelo canal ${canais.find((c) => c.id === canalCond)?.nome ?? ""}` : "";
      const espera = Number(carencia) > 0 ? `, a partir de ${Number(carencia)} min depois da abertura,` : "";
      return `Quando ninguém do setor ${nomeSetorCond} estiver conectado${espera} o chat que chegar${canal} ou estiver esperando lá vai para ${destinoTexto}. Cada atendimento é desviado uma vez só.`;
    }

    const partes: string[] = [];
    if (setorCond !== QUALQUER) partes.push(`no setor ${setores.find((s) => s.id === setorCond)?.name ?? ""}`);
    if (pessoaCond !== QUALQUER) partes.push(`para ${pessoas.find((p) => p.user_id === pessoaCond)?.nome ?? ""}`);
    if (canalCond !== QUALQUER) partes.push(`pelo canal ${canais.find((c) => c.id === canalCond)?.nome ?? ""}`);
    if (partes.length === 0) return null;

    const destino =
      acao === "route_to_department"
        ? `a fila do setor ${setores.find((s) => s.id === setorDestino)?.name ?? "(escolha)"}`
        : `${pessoas.find((p) => p.user_id === pessoaDestino)?.nome ?? "(escolha)"}`;

    const quando = temporaria
      ? fim
        ? `${inicio ? `De ${new Date(inicio).toLocaleString("pt-BR")}` : "De agora"} até ${new Date(fim).toLocaleString("pt-BR")}`
        : "Enquanto a janela estiver preenchida"
      : "Sem prazo";

    return `${quando}, todo chat que entrar ${partes.join(" e ")} vai para ${destino}.`;
  }, [gatilho, carencia, setorCond, pessoaCond, canalCond, acao, setorDestino, pessoaDestino, temporaria, inicio, fim, setores, pessoas, canais]);

  const salvar = () => {
    // A tela repete as travas do banco para o recado ser em português, não em
    // nome de constraint.
    if (!nome.trim()) return setErro("Dê um nome para a automação.");
    if (semAgente && setorCond === QUALQUER) {
      return setErro("Escolha o setor que, sem ninguém conectado, deve passar os chats adiante.");
    }
    const minutos = Number(carencia);
    if (semAgente && (!Number.isFinite(minutos) || minutos < 0 || minutos > 480)) {
      return setErro("A espera depois da abertura tem de ficar entre 0 e 480 minutos.");
    }
    if (setorCond === QUALQUER && pessoaCond === QUALQUER && canalCond === QUALQUER) {
      return setErro("Escolha ao menos uma condição. Sem nenhuma, a regra pegaria todo chat da operação.");
    }
    if (acao === "route_to_department" && !setorDestino) return setErro("Escolha o setor de destino.");
    if (acao === "route_to_agent" && !pessoaDestino) return setErro("Escolha a pessoa de destino.");
    if (acao === "route_to_department" && setorDestino === setorCond) {
      return setErro("O setor de destino é o mesmo da condição, então a regra não faria nada.");
    }
    if (acao === "route_to_agent" && pessoaDestino === pessoaCond) {
      return setErro("A pessoa de destino é a mesma da condição, então a regra não faria nada.");
    }
    if (temporaria && !fim) return setErro("Diga quando a automação termina, ou marque como fixa.");
    if (temporaria && inicio && fim && new Date(fim) <= new Date(inicio)) {
      return setErro("O fim tem de ser depois do começo.");
    }

    setErro(null);
    onSave({
      ...(rule?.id ? { id: rule.id } : {}),
      name: nome.trim(),
      trigger_event: gatilho,
      grace_minutes: semAgente ? Math.round(minutos) : 30,
      match_department_id: setorCond === QUALQUER ? null : setorCond,
      // o banco recusa condição de pessoa no gatilho "sem agente"
      match_agent_id: semAgente || pessoaCond === QUALQUER ? null : pessoaCond,
      match_instance_id: canalCond === QUALQUER ? null : canalCond,
      action: acao,
      target_department_id: acao === "route_to_department" ? setorDestino : null,
      target_agent_id: acao === "route_to_agent" ? pessoaDestino : null,
      starts_at: temporaria ? paraIso(inicio) ?? new Date().toISOString() : null,
      ends_at: temporaria ? paraIso(fim) : null,
      priority: Number(prioridade) || 10,
      is_active: rule?.is_active ?? true,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rule?.id ? "Editar automação" : "Nova automação"}</DialogTitle>
          <DialogDescription>
            Vale para o chat que chega e também para o que já está esperando na fila (em até 1 minuto).
            Atendimento em andamento não muda de dono.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="automacao-nome">Nome da automação</Label>
            <Input
              id="automacao-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Falta no Financeiro"
            />
          </div>

          {/* 1. Quando */}
          <div className="rounded-lg border p-4 space-y-4">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-md bg-muted text-[11px] font-bold text-muted-foreground">
                1
              </span>
              <span className="text-sm font-semibold">Quando</span>
              <span className="text-xs text-muted-foreground">o que precisa acontecer</span>
            </div>

            <div className="space-y-2">
              <Label>Gatilho</Label>
              <Select
                value={gatilho}
                onValueChange={(v) => {
                  setGatilho(v as AutomationTrigger);
                  // condição de pessoa não existe no gatilho "sem agente"
                  if (v === "no_agent_available") setPessoaCond(QUALQUER);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chat_inbound">Chat entra no atendimento</SelectItem>
                  <SelectItem value="no_agent_available">Setor ficou sem ninguém conectado</SelectItem>
                </SelectContent>
              </Select>
              {semAgente && (
                <p className="text-xs text-muted-foreground">
                  Dispara quando ninguém do setor está conectado. Quem está em pausa conta como presente, e setor lotado
                  não dispara. O sistema considera que a pessoa saiu uns 20 minutos depois de o navegador dela parar de
                  responder.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{semAgente ? "Setor que ficou sem ninguém" : "Setor de destino do chat"}</Label>
                <Select
                  value={semAgente && setorCond === QUALQUER ? "" : setorCond}
                  onValueChange={setSetorCond}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha o setor" />
                  </SelectTrigger>
                  <SelectContent>
                    {!semAgente && <SelectItem value={QUALQUER}>Qualquer setor</SelectItem>}
                    {setores.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {semAgente ? (
                <div className="space-y-2">
                  <Label htmlFor="automacao-carencia">Esperar depois da abertura (min)</Label>
                  <Input
                    id="automacao-carencia"
                    type="number"
                    min={0}
                    max={480}
                    value={carencia}
                    onChange={(e) => setCarencia(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Dá tempo de a equipe chegar. Sem isso, logo na abertura os chats da madrugada sairiam do setor antes
                    de alguém sentar.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Pessoa (opcional)</Label>
                  <Select value={pessoaCond} onValueChange={setPessoaCond}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={QUALQUER}>Qualquer pessoa</SelectItem>
                      {pessoas.map((p) => (
                        <SelectItem key={p.user_id} value={p.user_id}>
                          {p.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Canal (opcional)</Label>
              <Select value={canalCond} onValueChange={setCanalCond}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={QUALQUER}>Qualquer canal</SelectItem>
                  {canais.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                A automação troca o destino do chat, não cria um. Chat que ainda não tem setor (URA na tela do cliente,
                ou canal sem setor vinculado) segue o caminho normal.
              </p>
            </div>
          </div>

          {/* 2. Então */}
          <div className="rounded-lg border p-4 space-y-4">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-md bg-muted text-[11px] font-bold text-muted-foreground">
                2
              </span>
              <span className="text-sm font-semibold">Então</span>
              <span className="text-xs text-muted-foreground">para onde o chat vai</span>
            </div>

            <RadioGroup
              value={acao}
              onValueChange={(v) => setAcao(v as AutomationAction)}
              className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
            >
              <label
                className={cn(
                  "flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer",
                  acao === "route_to_department" ? "border-success bg-success/5" : "border-border",
                )}
              >
                <RadioGroupItem value="route_to_department" className="mt-0.5" />
                <span>
                  <span className="block text-sm font-semibold">Fila de outro setor</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Entra na fila e a regra de atribuição do setor escolhe o agente.
                  </span>
                </span>
              </label>

              <label
                className={cn(
                  "flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer",
                  acao === "route_to_agent" ? "border-success bg-success/5" : "border-border",
                )}
              >
                <RadioGroupItem value="route_to_agent" className="mt-0.5" />
                <span>
                  <span className="block text-sm font-semibold">Pessoa específica</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Vai direto para ela, mesmo que a fila dela esteja cheia.
                  </span>
                </span>
              </label>
            </RadioGroup>

            {acao === "route_to_department" ? (
              <div className="space-y-2">
                <Label>Setor de destino</Label>
                <Select value={setorDestino} onValueChange={setSetorDestino}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha o setor" />
                  </SelectTrigger>
                  <SelectContent>
                    {setores
                      .filter((s) => s.id !== setorCond)
                      .map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Pessoa de destino</Label>
                <Select value={pessoaDestino} onValueChange={setPessoaDestino}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha a pessoa" />
                  </SelectTrigger>
                  <SelectContent>
                    {pessoas
                      .filter((p) => p.user_id !== pessoaCond)
                      .map((p) => (
                        <SelectItem key={p.user_id} value={p.user_id}>
                          {p.nome}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Mandar o chat para alguém de outro setor move o chat para o setor dessa pessoa, como em qualquer
                  atribuição manual.
                </p>
              </div>
            )}
          </div>

          {/* 3. Prazo */}
          <div className="rounded-lg border p-4 space-y-4">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-md bg-muted text-[11px] font-bold text-muted-foreground">
                3
              </span>
              <span className="text-sm font-semibold">Por quanto tempo</span>
            </div>

            <RadioGroup
              value={temporaria ? "temp" : "fixa"}
              onValueChange={(v) => setTemporaria(v === "temp")}
              className="flex gap-5"
            >
              <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="temp" />
                Temporária
              </label>
              <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="fixa" />
                Fixa, sem prazo
              </label>
            </RadioGroup>

            {temporaria && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="automacao-inicio">Começa</Label>
                    <Input
                      id="automacao-inicio"
                      type="datetime-local"
                      value={inicio}
                      onChange={(e) => setInicio(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="automacao-fim">Termina</Label>
                    <Input
                      id="automacao-fim"
                      type="datetime-local"
                      value={fim}
                      onChange={(e) => setFim(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex gap-2 flex-wrap items-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => {
                      setInicio(paraInput(new Date().toISOString()));
                      setFim(fimDoDiaUtil());
                    }}
                  >
                    Só hoje
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => {
                      setInicio(paraInput(new Date().toISOString()));
                      setFim(proximaSexta());
                    }}
                  >
                    Até sexta
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => {
                      setInicio(paraInput(new Date().toISOString()));
                      setFim(hoje(19, 0, 7));
                    }}
                  >
                    1 semana
                  </Button>
                  <span className="ml-auto text-xs text-muted-foreground">Horário de Brasília</span>
                </div>
              </>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              <Label htmlFor="automacao-prioridade">Prioridade</Label>
              <Input
                id="automacao-prioridade"
                type="number"
                min={0}
                value={prioridade}
                onChange={(e) => setPrioridade(e.target.value)}
                className="w-24"
              />
              <span className="text-xs text-muted-foreground">
                Se duas automações pegarem o mesmo chat, vence a de menor número.
              </span>
            </div>
          </div>

          {resumo && (
            <div className="rounded-lg bg-muted border-l-[3px] border-accent px-3.5 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-accent mb-1">Resumo</div>
              <div className="text-sm leading-relaxed">{resumo}</div>
            </div>
          )}

          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3.5 py-3 text-sm text-destructive">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{erro}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground self-center">
            Toda aplicação fica registrada no histórico.
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando..." : "Salvar automação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
