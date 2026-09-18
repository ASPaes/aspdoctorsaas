import { useMemo, useState } from "react";
import { Check, Info, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAppTimezone } from "@/hooks/useAppTimezone";
import { DIAS_CURTOS, FUSOS_BR, type AccessInterval } from "@/lib/accessWindow";
import { OpcoesMultiSelect, type OpcaoMulti } from "./OpcoesMultiSelect";
import type { AccessSchedule, AccessTarget, PessoaAcesso, SalvarRegra } from "./useHorarioAcesso";

const AVISO_OPCOES = [
  { v: "15", l: "15 min antes" },
  { v: "10", l: "10 min antes" },
  { v: "5", l: "5 min antes" },
  { v: "0", l: "Não avisar" },
];
const TOLERANCIA_OPCOES = ["0", "5", "10", "15", "30"];

const INTERVALO_PADRAO: AccessInterval = { start: "08:00", end: "18:00", days: [1, 2, 3, 4, 5] };

function minutos(h: string) {
  const [a, b] = h.split(":").map(Number);
  return a * 60 + b;
}

/** Mesma validação do banco, para o erro aparecer antes de salvar. */
function erroDosIntervalos(ivs: AccessInterval[]): string | null {
  if (ivs.length === 0) return "Adicione pelo menos um intervalo.";
  for (let i = 0; i < ivs.length; i++) {
    const iv = ivs[i];
    if (!iv.start || !iv.end) return `Intervalo ${i + 1}: preencha início e fim.`;
    if (iv.end !== "24:00" && minutos(iv.end) <= minutos(iv.start))
      return `Intervalo ${i + 1}: o fim precisa ser depois do início. Para virar a noite, use dois intervalos (até 24:00 e a partir de 00:00).`;
    if (iv.days.length === 0) return `Intervalo ${i + 1}: marque pelo menos um dia.`;
  }
  return null;
}

export function RegraAcessoForm({
  regra,
  regras,
  alvos,
  setores,
  pessoas,
  salvando,
  onSalvar,
  onVoltar,
}: {
  regra: AccessSchedule | null;
  regras: AccessSchedule[];
  alvos: AccessTarget[];
  setores: { id: string; name: string }[];
  pessoas: PessoaAcesso[];
  salvando: boolean;
  onSalvar: (r: SalvarRegra) => void;
  onVoltar: () => void;
}) {
  const { timezone: fusoEmpresa } = useAppTimezone();
  const meus = alvos.filter((a) => regra && a.schedule_id === regra.id);

  const [nome, setNome] = useState(regra?.name ?? "");
  const [fuso, setFuso] = useState(regra?.timezone ?? fusoEmpresa ?? "America/Sao_Paulo");
  const [ativa, setAtiva] = useState(regra?.is_active ?? true);
  const [intervalos, setIntervalos] = useState<AccessInterval[]>(
    regra?.intervals?.length ? regra.intervals.map((i) => ({ ...i, days: [...i.days] })) : [INTERVALO_PADRAO],
  );
  const [aviso, setAviso] = useState(String(regra ? regra.warn_before_minutes ?? 0 : 15));
  const [tolerancia, setTolerancia] = useState(String(regra?.grace_minutes ?? 10));
  const [devolverFila, setDevolverFila] = useState(regra?.release_queue_on_end ?? true);
  const setorDe = useMemo(() => new Map(pessoas.map((p) => [p.user_id, p.department_id])), [pessoas]);
  const nomeDaRegra = useMemo(() => new Map(regras.map((r) => [r.id, r.name])), [regras]);

  // O setor funciona como filtro da lista de pessoas. Setor sem ninguém marcado
  // = setor inteiro; com pessoas marcadas = só elas (decisão de 18/09). Por isso,
  // ao reabrir, o setor de cada pessoa marcada volta selecionado também.
  const [setorIds, setSetorIds] = useState<string[]>(() => {
    const ids = new Set(meus.flatMap((a) => (a.department_id ? [a.department_id] : [])));
    for (const a of meus) {
      const d = a.user_id ? setorDe.get(a.user_id) : null;
      if (d) ids.add(d);
    }
    return [...ids];
  });
  const [pessoaIds, setPessoaIds] = useState<string[]>(meus.flatMap((a) => (a.user_id ? [a.user_id] : [])));
  const [tentouSalvar, setTentouSalvar] = useState(false);

  const regraDoSetorInteiro = (setorId: string) => {
    const outra = alvos.find((a) => a.department_id === setorId && a.schedule_id !== regra?.id);
    return outra ? nomeDaRegra.get(outra.schedule_id) ?? "outra regra" : null;
  };

  // O setor nunca trava: escolher o Suporte só para filtrar 2 estagiárias tem de
  // funcionar mesmo que o Suporte inteiro já esteja noutra regra.
  const opcoesSetor: OpcaoMulti[] = setores.map((s) => {
    const outra = regraDoSetorInteiro(s.id);
    return { id: s.id, label: s.name, detalhe: outra ? `setor todo em ${outra}` : null };
  });

  const mudarSetores = (ids: string[]) => {
    setSetorIds(ids);
    // Quem era de um setor que saiu da seleção sai junto.
    if (ids.length > 0) setPessoaIds((prev) => prev.filter((u) => ids.includes(setorDe.get(u) ?? "")));
  };

  const opcoesPessoa: OpcaoMulti[] = pessoas
    .filter((p) => setorIds.length === 0 || setorIds.includes(p.department_id ?? "") || pessoaIds.includes(p.user_id))
    .map((p) => {
      const outra = alvos.find((a) => a.user_id === p.user_id && a.schedule_id !== regra?.id);
      return {
        id: p.user_id,
        label: p.nome,
        detalhe: p.department_name,
        // Admin aparece, mas travado: sumir da lista parecia defeito.
        bloqueio:
          p.origin === "exempt"
            ? "Admin, sempre livre"
            : outra
              ? `em ${nomeDaRegra.get(outra.schedule_id) ?? "outra regra"}`
              : null,
      };
    });

  // O que vai ser gravado: setor sem pessoa marcada entra inteiro.
  const setoresInteiros = setorIds.filter((s) => !pessoaIds.some((u) => setorDe.get(u) === s));
  const resumo = setorIds
    .map((s) => {
      const nomeSetor = setores.find((x) => x.id === s)?.name ?? "Setor";
      const n = pessoaIds.filter((u) => setorDe.get(u) === s).length;
      return n === 0 ? `${nomeSetor} (setor inteiro)` : `${nomeSetor} (${n} ${n === 1 ? "pessoa" : "pessoas"})`;
    })
    .concat(
      pessoaIds.filter((u) => !setorIds.includes(setorDe.get(u) ?? "")).map((u) => pessoas.find((p) => p.user_id === u)?.nome ?? "Pessoa"),
    );

  const setorOcupado = setoresInteiros.map((s) => [s, regraDoSetorInteiro(s)] as const).find(([, r]) => r);
  const erroIntervalos = erroDosIntervalos(intervalos);
  const erroNome = nome.trim() ? null : "Informe o nome da regra.";
  const erroAlvo = setorIds.length + pessoaIds.length > 0 ? null : "Escolha pelo menos um setor ou uma pessoa.";
  const erroSetor = setorOcupado
    ? `O setor ${setores.find((x) => x.id === setorOcupado[0])?.name} inteiro já está na regra "${setorOcupado[1]}". Marque as pessoas desta regra ou tire o setor.`
    : null;
  const erro = erroNome ?? erroAlvo ?? erroSetor ?? erroIntervalos;

  const mudarIntervalo = (i: number, patch: Partial<AccessInterval>) =>
    setIntervalos((prev) => prev.map((iv, k) => (k === i ? { ...iv, ...patch } : iv)));

  const alternarDia = (i: number, dia: number) =>
    setIntervalos((prev) =>
      prev.map((iv, k) =>
        k !== i ? iv : { ...iv, days: iv.days.includes(dia) ? iv.days.filter((d) => d !== dia) : [...iv.days, dia].sort() },
      ),
    );

  const salvar = () => {
    setTentouSalvar(true);
    if (erro) return;
    onSalvar({
      id: regra?.id ?? null,
      name: nome.trim(),
      timezone: fuso,
      is_active: ativa,
      intervals: intervalos,
      warn_before_minutes: aviso === "0" ? null : Number(aviso),
      grace_minutes: Number(tolerancia),
      release_queue_on_end: devolverFila,
      department_ids: setoresInteiros,
      user_ids: pessoaIds,
    });
  };

  const fusos = FUSOS_BR.some((f) => f.value === fuso) ? FUSOS_BR : [...FUSOS_BR, { value: fuso, label: fuso }];

  return (
    <div className="space-y-4 max-w-5xl">
      <section className="rounded-lg border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <h3 className="font-semibold">Informações gerais</h3>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Regra ativa
            <Switch checked={ativa} onCheckedChange={setAtiva} />
          </label>
        </header>
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ha-nome">
              Nome da regra <span className="text-destructive">*</span>
            </Label>
            <Input id="ha-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Setor Suporte" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-fuso">
              Fuso horário <span className="text-destructive">*</span>
            </Label>
            <Select value={fuso} onValueChange={setFuso}>
              <SelectTrigger id="ha-fuso">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fusos.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-setores">Setores</Label>
            <OpcoesMultiSelect
              id="ha-setores"
              opcoes={opcoesSetor}
              value={setorIds}
              onChange={mudarSetores}
              placeholder="Adicionar setor..."
              vazio="Nenhum setor ativo cadastrado."
              chipClassName="bg-sky-500/15 text-sky-700 dark:text-sky-300"
            />
            <p className="text-xs text-muted-foreground">
              Sem ninguém marcado, vale para o setor inteiro, inclusive quem entrar depois.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-pessoas">Usuários</Label>
            <OpcoesMultiSelect
              id="ha-pessoas"
              opcoes={opcoesPessoa}
              value={pessoaIds}
              onChange={setPessoaIds}
              placeholder={setorIds.length > 0 ? "Todo o setor (ou escolha pessoas)..." : "Adicionar pessoa..."}
              vazio={setorIds.length > 0 ? "Ninguém ativo nos setores escolhidos." : "Nenhuma pessoa disponível."}
            />
            <p className="text-xs text-muted-foreground">
              {setorIds.length > 0
                ? "Mostra só quem é dos setores escolhidos. Marcando pessoas, a regra vale só para elas."
                : "Sem setor escolhido, lista todo mundo. Regra por pessoa sempre vence a do setor."}
            </p>
          </div>
          {resumo.length > 0 && (
            <p className="rounded-md bg-muted/60 px-3 py-2 text-sm md:col-span-2">
              <span className="text-muted-foreground">A regra vale para: </span>
              {resumo.join(" · ")}
            </p>
          )}
        </div>
      </section>

      <section className="rounded-lg border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <h3 className="font-semibold">Intervalos de horário</h3>
          <span className="text-xs text-muted-foreground">Um dia pode ter mais de um intervalo (ex.: pausa de almoço).</span>
        </header>
        <div className="space-y-4 p-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="px-2 py-2 text-left font-medium">Início</th>
                  <th className="px-2 py-2 text-left font-medium">Fim</th>
                  {DIAS_CURTOS.map((d) => (
                    <th key={d} className="px-1 py-2 text-center font-medium">
                      {d}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {intervalos.map((iv, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-2">
                      <Input
                        id={`ha-ini-${i}`}
                        type="time"
                        aria-label={`Início do intervalo ${i + 1}`}
                        className="w-28 tabular-nums"
                        value={iv.start}
                        onChange={(e) => mudarIntervalo(i, { start: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        id={`ha-fim-${i}`}
                        type="time"
                        aria-label={`Fim do intervalo ${i + 1}`}
                        className="w-28 tabular-nums"
                        value={iv.end === "24:00" ? "23:59" : iv.end}
                        onChange={(e) => mudarIntervalo(i, { end: e.target.value === "23:59" ? "24:00" : e.target.value })}
                      />
                    </td>
                    {DIAS_CURTOS.map((d, dia) => {
                      const marcado = iv.days.includes(dia);
                      return (
                        <td key={d} className="px-1 py-2 text-center">
                          <button
                            type="button"
                            aria-pressed={marcado}
                            aria-label={`${d} no intervalo ${i + 1}`}
                            onClick={() => alternarDia(i, dia)}
                            className={cn(
                              "inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors",
                              marcado
                                ? "border-primary bg-primary text-primary-foreground"
                                : "bg-background hover:bg-muted",
                            )}
                          >
                            {marcado && <Check className="h-4 w-4" />}
                          </button>
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remover intervalo ${i + 1}`}
                        className="text-destructive hover:text-destructive"
                        onClick={() => setIntervalos((prev) => prev.filter((_, k) => k !== i))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setIntervalos((prev) => [...prev, { start: "08:00", end: "18:00", days: [] }])}
          >
            <Plus className="mr-2 h-4 w-4" />
            Adicionar intervalo
          </Button>
          <p className="text-xs text-muted-foreground">
            Fim em 23:59 vale como meia-noite, para emendar com um intervalo que começa às 00:00 do dia seguinte.
          </p>

          <SemanaResultante intervalos={intervalos} />
        </div>
      </section>

      <section className="rounded-lg border bg-card">
        <header className="border-b px-4 py-3">
          <h3 className="font-semibold">Quando o horário acabar</h3>
        </header>
        <div className="space-y-3 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Avisar antes</p>
                <p className="text-xs text-muted-foreground">Faixa no topo da tela, com contagem regressiva.</p>
              </div>
              <Select value={aviso} onValueChange={setAviso}>
                <SelectTrigger className="w-36" aria-label="Avisar antes">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AVISO_OPCOES.map((o) => (
                    <SelectItem key={o.v} value={o.v}>
                      {o.l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Tolerância</p>
                <p className="text-xs text-muted-foreground">Tempo extra para fechar o que está fazendo.</p>
              </div>
              <Select value={tolerancia} onValueChange={setTolerancia}>
                <SelectTrigger className="w-36" aria-label="Tolerância">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOLERANCIA_OPCOES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v === "0" ? "Nenhuma" : `${v} min`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex items-start gap-3 rounded-lg border p-3">
            <Switch checked={devolverFila} onCheckedChange={setDevolverFila} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">Devolver atendimentos abertos para a fila</span>
              <span className="block text-xs text-muted-foreground">
                Ao sair do horário, os chats em andamento da pessoa vão para a fila do setor em vez de ficarem parados com ela.
              </span>
            </span>
          </label>
          <div className="flex items-start gap-2 rounded-lg bg-sky-500/10 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
            <p>
              <b>Administradores nunca são bloqueados.</b> Assim, uma regra configurada errado não deixa a empresa sem
              acesso ao sistema.
            </p>
          </div>
        </div>
      </section>

      {tentouSalvar && erro && <p className="text-sm text-destructive">{erro}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onVoltar} disabled={salvando}>
          Voltar
        </Button>
        <Button onClick={salvar} disabled={salvando}>
          {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Salvar
        </Button>
      </div>
    </div>
  );
}

/** Barra por dia da semana: mostra o que a combinação de intervalos libera. */
function SemanaResultante({ intervalos }: { intervalos: AccessInterval[] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">Semana resultante</p>
      <div className="space-y-1">
        {DIAS_CURTOS.map((d, dia) => (
          <div key={d} className="flex items-center gap-2">
            <span className="w-8 text-xs font-semibold text-muted-foreground">{d}</span>
            <div className="relative h-4 flex-1 rounded bg-muted">
              {intervalos
                .filter((iv) => iv.days.includes(dia) && iv.start && iv.end)
                .map((iv, k) => {
                  const a = minutos(iv.start);
                  const b = iv.end === "24:00" ? 1440 : minutos(iv.end);
                  if (b <= a) return null;
                  return (
                    <span
                      key={k}
                      title={`${iv.start}–${iv.end}`}
                      className="absolute inset-y-0 rounded bg-primary/85"
                      style={{ left: `${(a / 1440) * 100}%`, width: `${((b - a) / 1440) * 100}%` }}
                    />
                  );
                })}
            </div>
          </div>
        ))}
        <div className="flex justify-between pl-10 text-[11px] text-muted-foreground tabular-nums">
          <span>00h</span>
          <span>06h</span>
          <span>12h</span>
          <span>18h</span>
          <span>24h</span>
        </div>
      </div>
    </div>
  );
}
