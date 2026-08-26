# Templates de Implantação por produto

**Data:** 26/08/2026
**Owner:** Alexandre (ASP)
**Origem:** um tenant novo hoje começa com a configuração de Implantação vazia e precisa
montar pipeline, etapas, checklist e catálogos à mão. A operação de PDV Legal da Digi Office
já é madura e serve de ponto de partida para as outras revendas do mesmo produto.

## Objetivo

Dois templates prontos na tela `Configuração · Implantação`, importáveis por qualquer tenant:

1. **PDV Legal** — cópia da operação da Digi Office, sem nada específico de cliente dela.
2. **Software genérico** — desenho enxuto, para quem não vende PDV.

Fora de escopo: criar template a partir da configuração de um tenant pela tela (decisão do
owner: templates ficam versionados no repositório, não em tabela).

## O que já existe

- RPC `apply_onboarding_blueprint(p_tenant_id uuid, p_blueprint jsonb)` — `SECURITY DEFINER`,
  cria pipelines + etapas + checklist plano e mescla os catálogos por `lower(nome)`. Usada hoje
  pelo diálogo "Gerar com IA" (`GenerateOperationAIDialog.tsx`).
- Trigger `trg_sync_onb_pipeline_phase` resolve `phase_id` a partir de `fase`, então inserir só
  `fase` continua correto para as duas jornadas padrão.
- `GenerateOperationAIDialog.tsx` já tem a tela de revisão com checkbox por etapa e por item de
  catálogo — é ela que o fluxo de template reaproveita.

## Por que a RPC de hoje não serve sozinha

Medido contra a configuração real da Digi Office:

| Lacuna | Consequência se ignorada |
|---|---|
| Sem grupos de checklist | Os 34 itens de "Treinamento Marcado" viram uma lista solta, sem "Balcão", "Mesa", "Geral" |
| Sem vínculo grupo → tipo de demanda | O checklist deixa de recortar por demanda; todo item aparece em toda jornada |
| `is_initial`/`is_final` forçados na primeira/última posição | Na Implantação PDV a etapa inicial é a **3ª** ("Treinamento Marcado"). A jornada nasceria começando em "Pendências" |
| Sem `inicia_sla`/`encerra_sla` | O SLA da jornada nunca abre nem fecha — o painel de tempo de entrega fica vazio |
| Sem `retorno_no_show` | "Pendente Agendar" não recebe de volta o treino faltado |
| Sem `cor` e `visible_sections` | Kanban monocromático e abas do cartão fora do padrão da etapa |
| Sem `produto_id` no pipeline | Não dá para amarrar o pipeline importado ao produto do tenant |

## Arquitetura

### 1. Templates versionados no repositório

```
src/pages/onboarding/config/templates/
  types.ts              # tipo OnboardingTemplate
  pdvLegal.ts
  softwareGenerico.ts
  index.ts              # export const ONBOARDING_TEMPLATES: OnboardingTemplate[]
```

`OnboardingTemplate` = metadados + blueprint estendido:

```ts
type OnboardingTemplate = {
  id: string;                 // "pdv-legal" | "software-generico"
  nome: string;               // "PDV Legal"
  descricao: string;          // uma linha, aparece no card de escolha
  produto_sugerido?: string;  // "PDV Legal" — pré-seleciona o produto do tenant por nome
  blueprint: TemplateBlueprint;
};

type TemplateStage = {
  nome: string;
  sla_minutos: number | null;
  pausa_sla?: boolean;
  cor?: string;
  is_initial?: boolean;
  is_final?: boolean;
  inicia_sla?: boolean;
  encerra_sla?: boolean;
  retorno_no_show?: boolean;
  visible_sections?: string[];
  checklist?: { texto: string; is_required: boolean }[];              // formato antigo (IA)
  checklist_groups?: {                                               // formato novo
    nome: string;
    demandas?: string[];        // nomes de tipos de demanda; criados se não existirem
    itens: { texto: string; is_required: boolean }[];
  }[];
};
```

`checklist` e `checklist_groups` são mutuamente exclusivos por etapa. Se os dois vierem,
`checklist_groups` vence e o plano é ignorado.

### 2. Motor: estender `apply_onboarding_blueprint`, não duplicar

Todos os campos novos são **opcionais**. Blueprint sem eles se comporta exatamente como hoje —
o fluxo "Gerar com IA" não muda de comportamento.

Mudanças na função:

- **Pipeline:** aceitar `produto_id` (`bigint`, FK lógica para `produtos.id`) quando
  presente; hoje sempre nulo.
- **Etapa:** gravar `cor`, `inicia_sla`, `encerra_sla`, `retorno_no_show`, `visible_sections`
  quando presentes, com os defaults de hoje quando ausentes.
- **Etapa:** se `is_initial`/`is_final` vierem explícitos em **qualquer** etapa do pipeline, usar
  o que veio e **não** rodar o `UPDATE` que força min/max de `position`. Se nenhuma etapa
  declarar, mantém o comportamento atual.
- **Checklist agrupado:** para cada grupo, inserir em `onboarding_stage_checklist_groups`
  (`position` na ordem do array), depois os itens em `onboarding_stage_checklist` com `group_id`.
  Para cada nome em `demandas`, resolver o tipo de demanda por `lower(trim(nome))` dentro do
  tenant; **se não existir, criar** em `onboarding_demand_types` antes de gravar o vínculo em
  `onboarding_checklist_group_demand_types`. Isso garante que um template importado sem os
  catálogos ainda produza um checklist funcional.
- **Retorno:** somar `checklist_groups` ao jsonb de resultado, para a mensagem de sucesso.

A alteração é uma migration `CREATE OR REPLACE FUNCTION`. Antes de aplicar, reler
`pg_get_functiondef` imediatamente antes do replace (prod muda durante a sessão) e conferir que
os `GRANT` de `authenticated, service_role` continuam de pé depois.

### 3. Tela

- Botão **"Usar template"** ao lado de "Gerar com IA" no cabeçalho de `OnboardingConfigPage`,
  com a mesma permissão (`profile.role === "admin" || profile.is_super_admin`).
- `ApplyTemplateDialog.tsx`, em três telas:
  1. **Escolha** — cards dos templates (nome, descrição, "2 pipelines · 10 etapas · 54 itens").
  2. **Produto** — `Select` com os produtos ativos do tenant, pré-selecionando por nome quando
     `produto_sugerido` casa; opção "Sem produto" sempre disponível.
  3. **Revisão** — a mesma lista com checkbox da tela da IA, com os grupos de checklist
     renderizados aninhados sob a etapa. Botão "Aplicar".
- **Colisão de nome:** antes de aplicar, consultar `onboarding_pipelines` do tenant. Se já houver
  pipeline com o mesmo `nome` na mesma `fase`, avisar na tela de revisão e sufixar " (2)", " (3)"
  no nome enviado. Catálogos continuam mesclando por nome — "Novo Cliente" não duplica.
- Reaproveitar `formatSlaHuman` de `./utils` para exibir SLA.
- Depois de aplicar: `qc.invalidateQueries()` e toast com a contagem, igual ao fluxo da IA.

## Conteúdo dos templates

### Template 1 — PDV Legal

Espelho da Digi Office (`955178ba-…`), **removendo** tudo que é do cliente Nutrebem: os grupos
"Recolhimento de Dados", "Cadastro Fiscal - Nutrebem" e "Finalizar Ticket", e o tipo de demanda
"Novo Cliente - Nutrebem". Também sai o grupo "Checklist" vazio de "Treinamento Marcado".

**Pipeline `Onboarding PDV`** (fase `onboarding`), 5 etapas:

| # | Etapa | SLA | Flags | Cor |
|---|---|---|---|---|
| 1 | Novo Cliente | 120 | inicial, inicia SLA | `#0EA5E9` |
| 2 | Conferência | 120 | — | `#0EA5E9` |
| 3 | Recolhimento Dados | 480 | — | `#0EA5E9` |
| 4 | Cadastro Produtos | 960 | — | `#0EA5E9` |
| 5 | Marcar treinamento PDV | 480 | final | `#0EA5E9` |

Checklist (4 grupos, 20 itens; todos vinculados à demanda **Novo Cliente**, exceto onde indicado):

- **Conferência › "Checklist"** — Conferencia*; Mensagem de boas vindas*
- **Recolhimento Dados › "Validações"** — Validar modelo das maquininha*; Validar produtos com o
  cliente.*; Liberação do app PDV Legal*; Anexar print - Valid Produtos
- **Cadastro Produtos › "Cadastro Fiscal"** (demandas: Novo Cliente, Mudança Regime Fiscal) —
  Lançar licença no OEM; Fazer a planilha de produtos; Importar cadastro*; Configurar grupos*;
  Configurar usuários*; Configurar formas de pagamento*; Configurar filiais*; Configurar perfil
  PDV*; Configurar Fiscal; Envio e-mail XML contabilidade; Colocar dados do invoicy no Doctor Saas
- **Marcar treinamento PDV › "Marcação de Treinamento"** — Validar PDV nas maquininhas*; Enviar
  orientações sobre o agendamento*; Enviar link para agendamento

**Pipeline `Implantação PDV`** (fase `implantacao`), 5 etapas:

| # | Etapa | SLA | Flags | Cor |
|---|---|---|---|---|
| 1 | Pendências | 0 | — | `#EF4444` |
| 2 | Pendente Agendar | 0 | retorno no-show | `#F59E0B` |
| 3 | Treinamento Marcado | 120 | **inicial**, inicia SLA | `#22C55E` |
| 4 | No-Show | 0 | — | `#F59E0B` |
| 5 | Sub-tickets Finalizados | 0 | final, encerra SLA | `#22C55E` |

Checklist da etapa "Treinamento Marcado" (5 grupos, 34 itens, todos na demanda **Novo Cliente**):

- **Checklist PDV** — Fundo de caixa | Sangria*; Encerramento de caixa*
- **Check List Balcão** — Cancelamento de item*; Cancelamento total venda*; Desconto*;
  Recebimento*; Multiplicas formas de pagamento*
- **Check List Mesa** — Emissão de conta; Função fecha | paga; Nomear mesa; Mapa de mesa; Cores
  das mesas; Transferência; Reabertura; Pagamento Parcial; Processo 10%
- **Checklist Gestão | Retaguarda** — Enviar login do gestão*; Valorizar 100% online*; Cadastro
  grupo produtos*; Cadastro produtos (duplicar)*; Tabela de preços*; Cadastro usuário PDV*
- **Checklist Geral** — Alinhamento agenda no início*; Ressaltar benefícios pg integrado*;
  Valorizar já cadastramos produtos*; Marcar produtos como favorito*; Importância Modificadores*;
  Verificar PIX integrado*; Teste de estresse no final*; Apresentação final PDF*; Enviar vídeos no
  wpp*; Enviar contato do suporte*; Enviar pesquisa satisfação*; Enviar gravação treinamento*

`*` = obrigatório (`is_required = true`). Os textos vão **literais**, inclusive os erros de
digitação da Digi Office ("Conferencia", "Multiplicas formas de pagamento") — corrigir mudaria a
operação deles em relação ao template e criaria divergência silenciosa.

**Catálogos do template PDV Legal:**

- Tipos de demanda: Novo Cliente · Mudança Regime Fiscal · Up-Sell · Down-Sell · Treinamento Extra
  · Mudança de CNPJ · Mudança Servidor · Troca de adquirente
- Tipos de treino: Treinamento PDV (`conta_como_pdv = true`) · Segundo Treinamento · Estoque ·
  Financeiro · NF-e · Delivery Legal · Fidelidade Legal · Conta Assinada · Auto Atendimento Food ·
  iFood/99 · Mudança para Servidor Legal · Mudança de CNPJ
- Motivos de parada: Aguardando contabilidade · Aguardando inauguração · Aguardando maquininha ·
  Configuração Impressora
- Campos de contabilidade: Nome Contabilidade (text) · E-mail Contabilidade (text) · Telefone
  Contabilidade (number) · Anexo Certificado Digital (text) · Senha Certificado (text) · ID CSC
  (number) · CSC NFC-e (text) · Token IBPT (text)
- Retorno ao vendedor: Dados errados · Faltou dados · Falta de retorno do cliente (os três
  atribuíveis ao vendedor)

### Template 2 — Software genérico

Sem grupos por demanda: checklist plano, formato que a RPC já entende.

**Pipeline `Onboarding`** (fase `onboarding`), 4 etapas — `cor` `#0EA5E9`:

| # | Etapa | SLA | Flags | Checklist |
|---|---|---|---|---|
| 1 | Novo cliente | 240 | inicial, inicia SLA | Enviar mensagem de boas-vindas*; Confirmar contato do responsável* |
| 2 | Conferência do pedido | 480 | — | Conferir o que foi vendido*; Confirmar módulos contratados*; Registrar particularidades do cliente |
| 3 | Coleta de dados | 960 | — | Coletar dados cadastrais*; Coletar acessos e credenciais*; Receber base para migração; Validar infraestrutura do cliente* |
| 4 | Agendar treinamento | 480 | final | Alinhar agenda com o cliente*; Confirmar participantes*; Enviar link do treinamento* |

**Pipeline `Implantação`** (fase `implantacao`), 4 etapas:

| # | Etapa | SLA | Flags | Cor | Checklist |
|---|---|---|---|---|---|
| 1 | Treinamento agendado | 480 | inicial, inicia SLA | `#22C55E` | Confirmar presença na véspera*; Preparar ambiente do cliente* |
| 2 | Treinamento realizado | 480 | — | `#0EA5E9` | Registrar o que foi treinado*; Enviar material de apoio*; Enviar contato do suporte* |
| 3 | Acompanhamento | 1440 | — | `#F59E0B` | Confirmar primeiro uso real*; Tratar dúvidas do primeiro dia |
| 4 | Concluído | 0 | final, encerra SLA | `#22C55E` | Enviar pesquisa de satisfação*; Registrar conclusão* |

**Catálogos:** demanda Novo Cliente · treino "Treinamento" (`conta_como_pdv = true`) · motivos de
parada "Aguardando o cliente" e "Pendência financeira" · retorno ao vendedor "Dados incompletos" e
"Venda não corresponde à necessidade" (ambos atribuíveis).

## Validação

No Docker local (`.env.local` presente), aplicando em um tenant de teste:

1. Importar **PDV Legal** e diffar contra a Digi Office por query: 2 pipelines, 10 etapas com
   `nome`, `position`, `sla_minutos`, `cor`, `is_initial`, `is_final`, `inicia_sla`,
   `encerra_sla`, `retorno_no_show`, `visible_sections`; 9 grupos; 54 itens com `texto`,
   `is_required` e `position`; e os vínculos grupo → demanda. Tem que bater linha a linha, exceto
   os 3 grupos e a demanda de Nutrebem, que não podem aparecer.
2. Importar **Software genérico** e conferir 2 pipelines / 8 etapas / 21 itens sem grupo.
3. Reimportar o mesmo template no mesmo tenant: pipelines duplicam com sufixo, catálogos **não**
   duplicam.
4. Rodar o "Gerar com IA" com um blueprint sem os campos novos e confirmar que o resultado é
   idêntico ao de hoje (regressão do caminho antigo).
5. `bun run build` e `tsc -p tsconfig.app.json`.

Só depois de tudo verde, aplicar a migration da RPC em produção com OK do Alexandre.

## Riscos

- **A RPC é compartilhada com o fluxo de IA.** Qualquer regressão nela quebra o "Gerar com IA".
  Mitigado pelo teste 4 e por manter todos os campos novos opcionais.
- **`produto_id` amarrado por escolha do usuário**, não por nome — se a pessoa escolher errado, o
  ticket vai para o trilho errado (é o modo de falha de `onboarding-ticket-mudava-de-trilho`). A
  tela mostra o nome do produto escolhido na revisão, antes de aplicar.
- **Template envelhece.** A Digi Office vai mudar a operação dela e o template não acompanha.
  Aceito: o template é ponto de partida, não espelho vivo.
