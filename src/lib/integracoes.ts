/**
 * Catálogo das integrações do DoctorSaaS — a fonte única do que aparece na
 * página "Integrações" das Configurações.
 *
 * A página existe porque o menu só mostrava três siglas (Omie, Hiper, OEM) sem
 * dizer o que cada uma faz nem se está conectada. Aqui cada item carrega a
 * descrição e o grupo de negócio; o status vem do banco, medido por integração.
 *
 * `section` é o valor de `?section=` das Configurações. Item sem `section` não é
 * clicável: ou não tem tela ainda (Asaas) ou não há o que configurar por aqui
 * (AcessoFast, que é uma flag de contratação por tenant — a integração não tem
 * credencial: a janelinha recebe tudo pela URL).
 */

export type IntegracaoStatus =
  | { kind: "conectado"; detalhe?: string }
  | { kind: "ativo" }
  | { kind: "desconectado" }
  | { kind: "em-breve" }
  | { kind: "carregando" };

export type IntegracaoId = "oem" | "hiper" | "omie" | "asaas" | "acessofast";

export interface Integracao {
  id: IntegracaoId;
  nome: string;
  descricao: string;
  /** Seção das Configurações que o clique abre. Sem isso, o item não é clicável. */
  section?: string;
  /** Recurso RBAC. Sem permissão de `view`, o item não aparece. */
  resource?: string;
  /**
   * Status que não se mede: vale sempre e ignora o que vier do banco. É o caso
   * do que ainda não existe — perguntar ao banco por uma integração sem tabela
   * devolveria "não conectado", que é diferente de "ainda não fizemos".
   */
  statusFixo?: IntegracaoStatus;
}

export interface GrupoIntegracoes {
  label: string;
  itens: Integracao[];
}

export const INTEGRACOES_CATALOGO: GrupoIntegracoes[] = [
  {
    label: "Revendas",
    itens: [
      {
        id: "oem",
        nome: "PDV Legal (OEM)",
        descricao: "Licenças do PDV Legal/TabletCloud: vínculo com clientes, margem e pendências.",
        section: "integracoes-oem",
        resource: "cfg.integracoes_omie",
      },
      {
        id: "hiper",
        nome: "Hiper Software",
        descricao: "Sincroniza a carteira de clientes a partir do PortalHiper.",
        section: "integracoes-hiper",
        resource: "cfg.integracoes_hiper",
      },
    ],
  },
  {
    label: "Financeiro",
    itens: [
      {
        id: "omie",
        nome: "Omie",
        descricao: "Sincroniza clientes e contratos com o ERP Omie.",
        section: "integracoes-omie",
        resource: "cfg.integracoes_omie",
      },
      {
        id: "asaas",
        nome: "Asaas",
        descricao: "Cobrança e conciliação de boletos.",
        statusFixo: { kind: "em-breve" },
      },
    ],
  },
  {
    label: "Ferramentas",
    itens: [
      {
        id: "acessofast",
        nome: "AcessoFast",
        descricao: "Acesso remoto à máquina do cliente pelo botão Conectar, dentro do chat.",
      },
    ],
  },
];

/** Todo recurso RBAC citado no catálogo — usado para decidir se o menu aparece. */
export const INTEGRACOES_RESOURCES = Array.from(
  new Set(
    INTEGRACOES_CATALOGO.flatMap((g) => g.itens.map((i) => i.resource).filter(Boolean) as string[]),
  ),
);

export interface LinhaIntegracao extends Integracao {
  status: IntegracaoStatus;
}

export interface GrupoMontado {
  label: string;
  itens: LinhaIntegracao[];
}

/**
 * Monta os grupos para a tela: aplica permissão item a item e resolve o status.
 *
 * Grupo que ficou sem item some — sem cabeçalho órfão de "Revendas" vazio para
 * quem só enxerga o Omie.
 */
export function buildIntegracoesGroups(
  status: Partial<Record<IntegracaoId, IntegracaoStatus>>,
  canView: (resource: string) => boolean,
): GrupoMontado[] {
  return INTEGRACOES_CATALOGO.map((g) => ({
    label: g.label,
    itens: g.itens
      .filter((i) => !i.resource || canView(i.resource))
      .map((i) => ({
        ...i,
        status: i.statusFixo ?? status[i.id] ?? { kind: "desconectado" as const },
      })),
  })).filter((g) => g.itens.length > 0);
}

/** Rótulo do selo. Fica aqui para o teste cobrir o texto sem montar a árvore React. */
export function labelStatus(status: IntegracaoStatus): string {
  switch (status.kind) {
    case "conectado":
      return status.detalhe ? `Conectado · ${status.detalhe}` : "Conectado";
    case "ativo":
      return "Ativo";
    case "em-breve":
      return "Em breve";
    case "carregando":
      return "Verificando…";
    default:
      return "Não conectado";
  }
}
