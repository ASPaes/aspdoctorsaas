// As decisões do "Resumo da venda" que valem teste. Módulo puro de propósito:
// a tela é grande e o que erra aqui erra em silêncio.

export type ModoResumo = "importado" | "observacao";

/** Jornada importada do sistema comercial mostra o payload; o resto, o campo livre. */
export function modoDoResumo(propostaPayload: unknown): ModoResumo {
  return propostaPayload == null ? "observacao" : "importado";
}

export interface TemplateResumo {
  id: string;
  nome: string;
  corpo: string;
  /** null = serve a qualquer pipeline. */
  pipeline_id: string | null;
  ativo: boolean;
  position: number;
}

/**
 * O que o seletor do ticket oferece: os templates daquele pipeline mais os
 * genéricos. `pipelineId` nulo acontece de verdade — 13 das 342 jornadas em
 * produção (23/09/2026) não têm pipeline de onboarding — e nesse caso sobram
 * só os genéricos, em vez de a tela ficar sem opção nenhuma.
 */
export function templatesDoPipeline(
  todos: TemplateResumo[],
  pipelineId: string | null,
): TemplateResumo[] {
  return todos
    .filter((t) => t.ativo && (t.pipeline_id === null || t.pipeline_id === pipelineId))
    .sort((a, b) => a.position - b.position || a.nome.localeCompare(b.nome, "pt-BR"));
}

export interface FaseResumo {
  id: string;
  /** Slug das fases-semente: onboarding | implantacao | acompanhamento. Fase criada pelo tenant tem slug null. */
  slug: string | null;
  ativo: boolean;
}

export interface PipelineResumo {
  id: string;
  nome: string;
  phase_id: string;
  ativo: boolean;
  position: number;
}

/**
 * Pipelines que podem receber template. O template casa com o pipeline de
 * ONBOARDING da jornada, então oferecer pipeline de implantação seria cadastro
 * que nunca aparece no ticket. Tenant que não tem fase com slug `onboarding`
 * (as fases são cadastráveis e podem ter slug nulo) recebe todos os ativos —
 * melhor um select amplo do que um select vazio.
 */
export function pipelinesParaTemplate(
  fases: FaseResumo[],
  pipelines: PipelineResumo[],
): PipelineResumo[] {
  const ativos = pipelines.filter((p) => p.ativo);
  const faseOnb = fases.find((f) => f.slug === "onboarding");
  const lista = faseOnb ? ativos.filter((p) => p.phase_id === faseOnb.id) : ativos;
  return [...lista].sort((a, b) => a.position - b.position || a.nome.localeCompare(b.nome, "pt-BR"));
}

/**
 * O UPDATE do texto. Campo esvaziado grava null e solta o template: guardar ""
 * com template preso faria a tela reabrir dizendo que usa um modelo que não
 * está mais escrito ali.
 */
export function montarUpdateResumo(
  texto: string,
  templateId: string | null,
  userId: string | null | undefined,
) {
  const limpo = texto.trim();
  return {
    resumo_venda_texto: limpo === "" ? null : texto,
    resumo_venda_template_id: limpo === "" ? null : templateId,
    resumo_venda_updated_at: new Date().toISOString(),
    // Sessão sem usuário grava null: a coluna é nullable e sem FK, e string
    // vazia faria o Postgres devolver "invalid input syntax for type uuid".
    resumo_venda_updated_by: userId || null,
  };
}

/**
 * Tem alteração pendente? Não basta comparar o texto: escolher um template de
 * corpo vazio (todo template nasce assim) num campo vazio muda o vínculo sem
 * mudar uma letra, e o Salvar ficaria desabilitado para sempre.
 */
export function estaSujo(
  texto: string,
  textoInicial: string,
  templateId: string | null,
  templateInicial: string | null,
): boolean {
  return texto !== textoInicial || templateId !== templateInicial;
}

/**
 * O UPDATE do resumo é condicionado ao `resumo_venda_updated_at` que a tela
 * carregou. Se ninguém salvou no meio, volta 1 linha; se alguém salvou, volta 0
 * e o texto da outra pessoa continua lá. Retorno que não é lista conta como
 * conflito: tratar o inesperado como sucesso é o jeito de perder texto calado.
 */
export function houveConflito(linhasAfetadas: unknown): boolean {
  return !Array.isArray(linhasAfetadas) || linhasAfetadas.length === 0;
}
