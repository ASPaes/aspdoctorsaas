# Resumo da venda: aba fixa, observação livre e templates por pipeline

Data: 23/09/2026 · Owner: Alexandre (ASP) · Módulo: Onboarding & Implantação

## Problema

A aba "Resumo da venda" do ticket de onboarding só existe quando a jornada veio
importada do sistema comercial — a condição é `onboarding_journeys.proposta_payload
IS NOT NULL` (`useTemProposta`, em `src/pages/onboarding/PropostaVendaSection.tsx`).
Jornada criada a mão não tem aba nenhuma, e o que o vendedor sabe da venda não
chega ao especialista de implantação por caminho nenhum dentro do produto.

## O que muda

1. A aba passa a existir **sempre**.
2. Com `proposta_payload`, a tela é **a de hoje, sem uma linha de diferença**.
3. Sem `proposta_payload`, a aba vira um campo de observação livre onde o
   comercial escreve o que quiser sobre a venda.
4. Na Configuração · Implantação entra uma aba nova para cadastrar **templates de
   resumo por pipeline**: blocos de texto com as perguntas que o vendedor deve
   responder. No ticket, escolher o template insere esse texto no campo.

Decidido com o owner em 23/09/2026:

- O template é **um bloco de texto**, não um conjunto de campos pergunta/resposta.
  O vendedor edita o texto inteiro à vontade depois de inserido.
- O template se amarra ao pipeline de **Onboarding** da jornada
  (`onboarding_journeys.pipeline_onboarding_id`), não ao de Implantação.
- Com integração, o campo de observação **não aparece**. A tela importada fica
  intocada.

## Modelo de dados

### Tabela nova: `onboarding_sale_summary_templates`

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid pk default gen_random_uuid() | |
| `tenant_id` | uuid not null | |
| `pipeline_id` | uuid null → `onboarding_pipelines(id) on delete cascade` | **NULL = serve a qualquer pipeline** |
| `nome` | text not null | rótulo no seletor |
| `corpo` | text not null default '' | o texto inserido no campo |
| `ativo` | boolean not null default true | |
| `position` | integer not null default 0 | ordem no seletor e na lista |
| `created_at` / `updated_at` | timestamptz not null default now() | `updated_at` por trigger `set_updated_at()` |

Índice: `(tenant_id, pipeline_id, ativo, position)`.

RLS ligada, quatro policies iguais às das tabelas irmãs de configuração
(`onboarding_vendor_return_reasons`): `can_access_tenant_row(tenant_id)` em
SELECT/UPDATE/DELETE e em `WITH CHECK` no INSERT.

Grants: `authenticated` e `service_role`. **`REVOKE ALL FROM anon`** — as irmãs
herdaram o grant de `anon` do default do schema e sobrevivem só pela RLS; aqui a
tabela nasce sem esse grant, porque já custou caro neste projeto depender de uma
camada só.

### Colunas novas em `onboarding_journeys`

| coluna | tipo |
|---|---|
| `resumo_venda_texto` | text null |
| `resumo_venda_template_id` | uuid null → `onboarding_sale_summary_templates(id) on delete set null` |
| `resumo_venda_updated_at` | timestamptz null |
| `resumo_venda_updated_by` | uuid null, **sem FK** (guarda `auth.uid()`; é o mesmo que `responsavel_user_id` faz nesta tabela, que também não tem FK para `auth.users`) |

Só colunas, nada de alterar a `vw_onboarding_journeys`: são 53 colunas e recriar
a view já custou o `security_invoker` neste projeto. A leitura é a mesma consulta
sob demanda que `PropostaVendaSection` já faz por `journeyId`.

`resumo_venda_template_id` é registro de qual template foi usado, para o painel de
configuração saber que um template está em uso antes de deixarem apagá-lo. Não é
vínculo vivo: editar o template depois **não** mexe no texto já escrito na jornada.

## Tela do ticket

`PropostaVendaSection.tsx` passa a buscar, na mesma consulta, `proposta_payload`,
`resumo_venda_texto`, `resumo_venda_template_id` e `resumo_venda_updated_at/by`, e
decide o modo:

- **`proposta_payload` presente → modo importado.** Renderização idêntica à de
  hoje. Nenhum campo editável entra na tela.
- **`proposta_payload` nulo → modo observação.**

O modo observação tem:

- Seletor "Template", listando os templates `ativo` do tenant cujo `pipeline_id`
  é o `pipeline_onboarding_id` da jornada **ou** é NULL, ordenados por `position`.
  Sem nenhum template cadastrado, o seletor não aparece — só o campo.
- Escolher um template insere `corpo` no campo. Campo vazio: insere direto. Campo
  com texto: pergunta "Substituir o que está escrito?" antes de sobrescrever, com
  Substituir / Cancelar.
- Textarea de altura generosa (mín. ~18 linhas), `whitespace-pre-wrap`.
- Botão **Salvar** explícito, habilitado só com alteração pendente. **Sem
  autosave**: `onboarding_journeys` está na publication do Realtime e todo UPDATE
  gera WAL + fanout; salvar a cada tecla multiplicaria escrita numa tabela quente.
- Aviso de saída com alteração não salva (o sheet fecha por clique fora).
- Rodapé: "Editado por <nome> em dd/mm/aaaa hh:mm", com o nome vindo de
  `profiles.funcionario_id → funcionarios.nome` (não existe `full_name` em profiles).
- Salvar grava `resumo_venda_texto`, `resumo_venda_template_id` (o último inserido,
  ou NULL se nunca usou template), `resumo_venda_updated_at = now()` e
  `resumo_venda_updated_by = auth.uid()`, e invalida a query da aba.

A aba deixa de depender de `useTemProposta`: o botão em `JourneyDetailSheet.tsx`
(hoje envolto em `{temProposta && …}`) passa a ser incondicional, e o hook é
removido junto com seu import, por não sobrar chamador.

Quem abre a jornada pode editar o texto. **Sem portão de RBAC novo para a edição**
— decisão do owner; se depois for preciso restringir ao comercial, entra um
`usePortao` no botão Salvar e no textarea sem mexer no resto.

## Tela de configuração

Aba nova, a 11ª, em `OnboardingConfigPage.tsx`: value `resumo_venda`, rótulo
"Resumo da venda", portão `onb.cfg.resumo_venda` nascendo liberado como os outros
dez (`usePortao("onb.cfg.resumo_venda")`, `regraDeHoje` padrão `true`). Entra
também no catálogo de permissões, pelo mesmo caminho das migrations
`rbac_semear_implantacao_*`, senão a chave não aparece na tela de permissões.

Painel novo `src/pages/onboarding/config/SaleSummaryTemplatesPanel.tsx`, no molde
de `VendorReturnReasonsPanel`:

- Lista ordenável por arrastar (dnd-kit, `position`), cada linha com nome,
  etiqueta do pipeline (ou "Todos os pipelines"), switch de ativo e excluir.
- Editor do template selecionado ao lado: nome, pipeline (select com os pipelines
  da fase Onboarding do tenant + opção "Todos"), textarea do corpo e ativo.
- Excluir template em uso (`resumo_venda_template_id` apontando para ele) avisa
  quantas jornadas o usaram; o texto delas não se perde, só o vínculo (FK
  `on delete set null`).

O painel só lê e escreve `onboarding_sale_summary_templates`, filtrando por
`.eq('tenant_id', tid)` explícito com `useTenantFilter`, como o resto do módulo.

## Testes

Unitários, no que tem lógica de verdade — não em JSX de formulário:

1. **Escolha dos templates do seletor**: dado um `pipeline_onboarding_id` e uma
   lista de templates, retorna os do pipeline + os de `pipeline_id` NULL, só
   ativos, na ordem de `position`. Casos: nenhum template, só genéricos, pipeline
   sem template próprio, template inativo no pipeline certo.
2. **Decisão do modo**: `proposta_payload` presente → importado, mesmo com
   `resumo_venda_texto` preenchido; ausente → observação.
3. **Inserção do template**: campo vazio insere sem perguntar; campo com texto
   exige confirmação e, cancelando, não altera nada.

Teste de componente usa `createRoot` + `act` (RTL não funciona neste repo).

RLS conferida no banco local com JWT forjado: usuário do tenant A não lê nem
escreve template do tenant B; `anon` não lê nada.

## Fora de escopo

- Markdown ou formatação rica no corpo — é texto puro.
- Histórico de versões do texto (só o último autor e a data).
- Preencher o resumo automaticamente a partir de outra fonte.
- Qualquer mudança na tela do resumo importado.
