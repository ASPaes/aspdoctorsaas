// Mensagem do lote por número oficial da Meta (F2): fora da janela de 24 h a
// Meta só aceita template aprovado, então aqui não existe texto livre. Escolhe
// o template e preenche cada variável; o valor pode levar {nome_cliente} e as
// colunas da planilha, trocados por destinatário no banco.
import { useEffect, useMemo, useRef } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { inferParamSources, parseTemplateParams, renderTemplateText, hasInvalidParamChars } from "@/lib/metaTemplateParams";
import { aplicarTudo } from "./nomeNaMensagem";
import { useTemplatesAprovados } from "./useEnvioLoteExtras";

export interface EscolhaTemplate {
  templateId: string | null;
  /** Um valor por variável, na ordem do template. */
  valores: string[];
}

/** Formato que a RPC e o motor esperam: lista (posicional) ou objeto (nomeada). */
export function paramsParaRpc(componentes: unknown, valores: string[]): string[] | Record<string, string> | null {
  const spec = parseTemplateParams(componentes);
  if (spec.format === "NONE") return null;
  if (spec.format === "NAMED") return Object.fromEntries(spec.names.map((n, i) => [n, valores[i] ?? ""]));
  return spec.names.map((_, i) => valores[i] ?? "");
}

interface Props {
  instanceId: string;
  valor: EscolhaTemplate;
  onChange: (v: EscolhaTemplate) => void;
  variaveis: string[];
  exemplo: { nome: string; vars?: Record<string, string> | null } | null;
  /** Avisa a tela se dá para seguir (template escolhido e variáveis cheias). */
  onValido: (ok: boolean, componentes: unknown, corpo: string) => void;
}

export function MensagemTemplate({ instanceId, valor, onChange, variaveis, exemplo, onValido }: Props) {
  const { data: templates = [], isLoading } = useTemplatesAprovados(instanceId, true);
  const tpl = templates.find((t) => t.id === valor.templateId) || null;
  const spec = useMemo(() => (tpl ? parseTemplateParams(tpl.components) : null), [tpl]);
  const focado = useRef<number>(0);

  // Template novo: a variável logo depois de "Olá" já vem com {nome_cliente}.
  useEffect(() => {
    if (!tpl || !spec) return;
    if (valor.valores.length === spec.names.length) return;
    const fontes = inferParamSources(tpl.body_text, spec);
    onChange({ templateId: tpl.id, valores: spec.names.map((_, i) => (fontes[i] === "contact" ? "{nome_cliente}" : "")) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl?.id, spec]);

  const ok = !!tpl && !!spec && spec.unsupported.length === 0
    && spec.names.every((_, i) => (valor.valores[i] ?? "").trim() !== "" && !hasInvalidParamChars(valor.valores[i] ?? ""));
  useEffect(() => { onValido(ok, tpl?.components ?? null, tpl?.body_text ?? ""); }, [ok, tpl, onValido]);

  const inserir = (token: string) => {
    if (!spec) return;
    const i = Math.min(focado.current, spec.names.length - 1);
    const novos = [...valor.valores];
    novos[i] = (novos[i] || "") + token;
    onChange({ ...valor, valores: novos });
  };

  const previa = tpl && spec
    ? renderTemplateText(tpl.body_text, spec, spec.names.map((_, i) => aplicarTudo(valor.valores[i] ?? "", exemplo?.nome || "cliente", exemplo?.vars, false) || "-"))
    : "";

  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-3">
        <div className="rounded-lg bg-sky-500/10 px-3 py-2 text-xs">
          Número oficial da Meta: a mensagem sai por um <b>template aprovado</b>. Texto livre só funciona para quem escreveu nas últimas 24 horas, então aqui não tem.
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Template</Label>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando templates...</div>
          ) : templates.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
              Este número não tem template aprovado. Crie e sincronize em Configurações, WhatsApp, Templates.
            </div>
          ) : (
            <Select value={valor.templateId ?? undefined} onValueChange={(id) => onChange({ templateId: id, valores: [] })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Escolha o template" /></SelectTrigger>
              <SelectContent>
                {templates.map((t) => {
                  const s = parseTemplateParams(t.components);
                  return (
                    <SelectItem key={t.id} value={t.id} disabled={s.unsupported.length > 0}>
                      {t.name} · {t.language}{s.unsupported.length ? " (não suportado)" : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          )}
        </div>

        {spec && spec.unsupported.length > 0 && (
          <div className="flex gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {spec.unsupported.join("; ")}
          </div>
        )}

        {spec && spec.names.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs">Variáveis do template</Label>
            {spec.names.map((n, i) => (
              <div key={n} className="flex items-center gap-2">
                <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">{`{{${n}}}`}</span>
                <Input
                  className="h-9"
                  value={valor.valores[i] ?? ""}
                  placeholder={spec.examples[i] ? `Ex.: ${spec.examples[i]}` : "Valor"}
                  onFocus={() => { focado.current = i; }}
                  onChange={(e) => { const novos = [...valor.valores]; novos[i] = e.target.value; onChange({ ...valor, valores: novos }); }}
                  aria-label={`Valor da variável ${n}`}
                />
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Inserir no campo:</span>
              {["nome_cliente", ...variaveis].map((v) => (
                <button key={v} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => inserir(`{${v}}`)}
                  className="rounded-md border border-dashed border-sky-500 bg-sky-500/10 px-2 py-0.5 font-mono text-sky-700 dark:text-sky-300">
                  {`{${v}}`}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">A Meta recusa variável vazia: se um destinatário não tiver o valor, vai "-".</p>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Prévia{exemplo ? ` para ${exemplo.nome || "cliente"}` : ""}</Label>
        <div className="flex min-h-[240px] flex-col rounded-lg border border-border bg-[#EFEAE2] p-3 dark:bg-[#0B141A]">
          <div className="relative ml-auto max-w-[92%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-[#D9FDD3] px-2.5 pb-4 pt-2 text-[13.5px] text-[#111B21] shadow-sm dark:bg-[#005C4B] dark:text-[#E9EDEF]">
            {previa || <span className="opacity-50">Escolha um template</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
