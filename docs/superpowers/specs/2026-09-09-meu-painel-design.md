# Meu Painel — dashboard personalizado por usuário

**Data:** 09/09/2026
**Status:** desenho aprovado. Nada implementado.
**Mockup aprovado:** https://claude.ai/code/artifact/85ddb187-cd28-4d5d-a757-251855f7c4eb

---

## 1. Problema

O DoctorSaaS espalha os indicadores por cinco dashboards com abas próprias. Um head
que acompanha a operação diariamente olha três ou quatro números que estão em telas
diferentes, e precisa reaplicar filtro em cada uma. Não existe hoje nenhuma tela que
junte "o que eu olho todo dia".

## 2. O que este módulo é

Uma aba nova no Dashboard onde admin e head montam a própria tela: escolhem até 15
indicadores ou gráficos entre os que já existem no sistema, agrupam em seções e dão a
cada seção o filtro que faz sentido para ela. O painel salvo é pessoal e vira a visão
diária de quem montou.

## 3. Decisões fechadas

| Decisão | Valor |
|---|---|
| Onde fica | Aba "Meu Painel" dentro de `src/pages/Dashboard.tsx` |
| Barra de filtro global | Escondida quando a aba "Meu Painel" está ativa |
| Quem monta | `role` = `admin` ou `head`, mais super admin. `user` não vê o módulo |
| Alcance | Painel pessoal. Ninguém publica painel para outro |
| Seção | Nome livre + uma área + filtro próprio + lista de itens |
| Seções da mesma área | Permitido, com filtros diferentes |
| Limite | 15 itens no painel inteiro, 5 seções |
| Gráfico | Conta como 1 dos 15 |
| Áreas | Atendimento, Financeiro/MRR, Customer Success, Implantação, Certificados A1 |
| Fora | Painel de Uso |
| Persistência | Tabela nova `user_dashboards` |
| Origem dos números | Reúso dos hooks dos dashboards atuais |
| Telas existentes | **Intocadas.** As 7 abas atuais continuam idênticas. Nenhum hook, card ou gráfico existente é alterado, movido ou refatorado |
| Primeiro acesso | Painel vazio com botão "Montar painel". Sem sugestão automática |

## 4. O catálogo de indicadores

### 4.1 O que existe hoje

- `src/lib/kpiHelp.ts` — 172 verbetes com título, definição, por que importa, fórmula,
  benchmark e como melhorar. É o texto de ajuda, não um catálogo: não sabe de onde vem
  o número nem em que tela ele aparece.
- 105 desses verbetes estão amarrados a um card via `helpKey`. Os outros 67 são verbete
  sem card, ou card com nome divergente.
- Cards renderizados com `KPICardEnhanced`: 100 instâncias em 15 arquivos. Implantação e
  Customer Success usam componentes de card próprios (`src/pages/onboarding/KpiCard.tsx`,
  blocos dentro de `CSDashboard.tsx`).
- Gráficos: 5 componentes parametrizáveis (`BarChartCard`, `LineChartCard`,
  `PieChartCard`, `MultiLineChartCard`, `SyncedMultiLineChartCard`), ~14 componentes
  próprios (`NetNewMrrStackedChart`, `ChurnPorSegmentoChart`, `TenureBucketsChart`,
  `BrazilChoroplethMap`, `MotivoSegmentoHeatmap`, `LatenciaHistograma`,
  `VelocidadeTimeline` e outros), e ~22 gráficos escritos direto dentro da aba com
  `ResponsiveContainer` — 9 só na `VendasTab.tsx`.

**"Mais de 180 indicadores" não se confirma como lista única.** O levantamento vai
devolver o número exato. A estimativa é 110–130 cards e ~40 gráficos.

### 4.2 O registro

Arquivo novo `src/lib/kpiCatalog.ts`, uma entrada por item:

```ts
export type KpiArea = 'atendimento' | 'financeiro' | 'cs' | 'implantacao' | 'certificados';
export type KpiKind = 'card' | 'chart';

export interface CatalogEntry {
  /** Identificador estável. Nunca muda depois de salvo num painel de alguém. */
  id: string;
  area: KpiArea;
  kind: KpiKind;
  /** Rótulo exibido. Espelha o texto que já aparece no dashboard de origem. */
  label: string;
  /** Chave em kpiHelp para o popover de ajuda. Ausente = item sem verbete. */
  helpKey?: string;
  unit?: KpiUnit;
  /** Como formatar o valor cru para exibição. */
  format: 'currency' | 'percent' | 'integer' | 'decimal' | 'duration' | 'ratio';
  /** De onde o valor sai. Ver §5. */
  source: { provider: string; path: string };
  /** Só para kind: 'chart'. Largura em colunas da grade de 4. */
  span?: 2 | 3 | 4;
  /** Só para kind: 'chart'. Componente que desenha. */
  render?: string;
  /** Item conhecido mas ainda não disponível (gráfico embutido na aba). */
  pending?: true;
}
```

Regras do registro:

- `id` é imutável. Um painel salvo guarda ids; renomear a chave quebraria o painel de
  quem já montou.
- Item sem `helpKey` entra no catálogo mesmo assim, sem o "?". O levantamento lista os
  órfãos dos dois lados para você decidir se vale escrever o verbete que falta.
- Gráfico ainda embutido na aba entra com `pending: true`. Aparece no catálogo apagado
  e não é selecionável. É o que torna visível o que falta, em vez de simplesmente sumir.

### 4.3 Como o levantamento é feito

Percorrer, tela por tela, os cinco dashboards; para cada card e gráfico visível,
registrar rótulo exato, hook de origem, campo lido e `helpKey` quando existir. O
resultado sai como tabela para aprovação item a item **antes** de virar código. Não é
trabalho de grep: rótulo na tela e chave no `kpiHelp` divergem em vários casos, e é
justamente essa divergência que precisa ser resolvida por decisão, não por heurística.

## 5. De onde vêm os números

### 5.0 Restrição dura: nada existente muda

Decisão do owner em 09/09/2026. O módulo **só lê**. Não altera hook, card,
gráfico, aba ou cálculo que já esteja no ar. A única escrita em arquivo
existente é acrescentar a aba nova em `src/pages/Dashboard.tsx` e o `if` que
esconde a barra global nela — sem isso não existe aba.

Duas consequências práticas:

- **Cálculo que hoje mora dentro de um componente não sobe para o provider.**
  Onde a tela de origem calcula na hora de exibir (a divergência CSAT, a
  contagem de produtos com ticket, o nome do ofensor #1), o painel refaz a
  mesma conta do seu lado, a partir do campo cru. Duplica lógica de exibição,
  e é o preço de não encostar na tela que já funciona.
- **Gráfico não é extraído da aba de origem.** Ver §10, F5.

### 5.1 A escolha

Cada seção monta o hook que a área já usa e lê os campos dos itens escolhidos. O painel
não recalcula nada.

**Por que reúso e não SQL novo:** uma RPC que calculasse os ~170 indicadores no banco
seria mais leve e mais rápida, mas reimplementaria em SQL cálculo que hoje vive em
TypeScript. Painel de gestão que mostra MRR diferente do Dashboard perde a confiança na
primeira semana, e o bug seria invisível — dois números plausíveis e discordantes. O
reúso torna a divergência impossível por construção.

### 5.2 Providers

Um provider por área. É a única peça que o painel precisa conhecer:

| Provider | Hook reaproveitado | Custo |
|---|---|---|
| `atendimento.volume` | `useAtendimentoVolume` | 1 RPC `get_atendimento_volume` |
| `atendimento.velocidade` | `useAtendimentoVelocidade` | 1 RPC |
| `atendimento.backlog` / `.agentes` / `.satisfacao` / `.cobertura` / `.ura` / `.taxonomia` / `.clientes` | hooks homônimos em `src/components/atendimento/` | 1 RPC cada |
| `financeiro.dashboard` | `useDashboardData` | ~20 varreduras via `fetchAllRows` |
| `cs.dashboard` | `useCSDashboardData` | a medir no levantamento |
| `implantacao.dash` | `dashMetrics.ts` + hooks de `src/pages/onboarding/` | a medir no levantamento |
| `certificados.a1` | `useCertA1Data` | a medir no levantamento |

O `path` da entrada do catálogo é o caminho dentro do retorno do provider
(ex.: `provider: 'atendimento.volume'`, `path: 'total'`). O painel resolve com um
acessador de caminho, sem `switch` gigante.

Os hooks recebem filtro por contexto React hoje (`AtendimentoFilterContext`,
`useDashboardFilters`). Como cada seção tem filtro próprio, **o painel não pode usar o
contexto global**: cada seção monta um provedor de contexto local com os valores da
seção. Duas seções de Atendimento com setores diferentes viram duas árvores de contexto
irmãs, e o `queryKey` do React Query já inclui os filtros — as duas consultas convivem
sem colidir em cache.

### 5.3 Carga preguiçosa

A seção só dispara suas consultas quando entra na viewport (`IntersectionObserver`).
Painel com Financeiro em quarto lugar não paga as 20 varreduras enquanto o gestor olha
Atendimento no topo.

### 5.4 Se o Financeiro pesar

O `useDashboardData` é a única fonte cara. Se na prática incomodar, o conserto é trocar
**só** o provider `financeiro.dashboard` por uma RPC de resumo que devolva os números
agregados de uma vez. O contrato do provider não muda, então nada mais é tocado. Isso é
fase posterior, não parte desta entrega.

## 6. Filtros por seção

Cada área declara seu conjunto de filtros. Não existe filtro global no painel.

| Área | Filtros |
|---|---|
| Atendimento | período, setor, agente, tipo (individual/grupo), plantão, segmento |
| Financeiro | período, fornecedor |
| Customer Success | período |
| Implantação | período, unidade, jornada |
| Certificados A1 | período |

Os filtros de Implantação e Certificados A1 precisam ser confirmados no levantamento
contra `useOnboardingDashFilters` e `useCertA1Data`.

O catálogo é travado na área da seção: dentro de uma seção de Atendimento filtrada por
setor não é possível adicionar um card de MRR. Sem essa trava o card ignoraria o filtro
em silêncio, que é pior que não permitir.

Unidade e tenant continuam vindo dos contextos globais (`useUnidadeFilter`,
`useTenantFilter`) — não são filtro de seção. Super admin simulando tenant vê o painel
do tenant simulado; o painel salvo é do usuário, o dado é do tenant efetivo.

## 7. Persistência

Tabela nova. `user_preferences` foi descartada: é a tabela de preferências de
notificação, tem linha por `(user_id, department_id)` e `prefer_department_overrides` —
guardar layout lá deixa ambíguo qual linha manda.

```sql
create table public.user_dashboards (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  user_id     uuid not null,
  layout      jsonb not null default '{"secoes":[]}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, user_id)
);
```

RLS: o usuário lê e escreve só a própria linha (`user_id = auth.uid()`), mais
`OR public.is_super_admin()`.

Formato do `layout`:

```json
{
  "versao": 1,
  "secoes": [
    {
      "id": "s1",
      "nome": "Suporte — hoje",
      "area": "atendimento",
      "filtros": { "periodo": "hoje", "departmentId": "uuid", "agentId": null,
                   "tipoAtendimento": "all", "plantao": "all" },
      "itens": [
        { "id": "at.chats_abertos" },
        { "id": "at.frt" },
        { "id": "at.volume_por_hora", "span": 3 }
      ]
    }
  ]
}
```

`periodo` é guardado como atalho relativo (`hoje`, `7d`, `mes_atual`) e não como par de
datas fixas. Painel diário com data congelada na hora em que foi montado é bug garantido
no dia seguinte. Intervalo absoluto continua possível e é gravado como
`{ "de": "...", "ate": "..." }`.

Item cujo `id` sumiu do catálogo é ignorado na renderização e reportado uma vez no
console — o painel de quem montou não quebra por causa de um indicador removido.

## 8. Interface

### 8.1 O painel

- `<TabsTrigger value="meu-painel">` como última aba do Dashboard, visível só para
  admin/head/super admin.
- A barra `<DashboardFilters>` de `Dashboard.tsx:58` é renderizada condicionalmente:
  escondida quando a aba ativa é `meu-painel`. As outras 7 abas não mudam em nada.
- Seção = cabeçalho (nome + selo da área + filtros da seção) e grade de 4 colunas.
  Card ocupa 1 coluna; gráfico ocupa 2, 3 ou 4.
- Todos os cards são renderizados com `KPICardEnhanced`, inclusive os de Implantação e
  CS que hoje usam componente próprio. O painel padroniza a aparência.
- Rodapé com "N de 15 indicadores" e os botões "Nova seção" e "Editar painel".
- Painel vazio: estado inicial com uma frase e o botão "Montar painel".

### 8.2 O construtor

Diálogo por cima da tela. Coluna esquerda com as seções (arrastáveis, com nome, selo da
área e contagem); coluna direita com o catálogo da seção selecionada: busca por texto,
chips de área com contagem, segmentado Tudo / Indicadores / Gráficos, e a lista em duas
colunas com caixa de seleção, rótulo e a primeira frase da definição vinda do `kpiHelp`.

Ao atingir 15, os itens não selecionados ficam apagados e a barra de cota avisa. Não
deixar salvar 20 e cortar depois.

Gráficos `pending: true` aparecem apagados com o selo "fase 2".

### 8.3 Padrão visual

Segue o Spatial UI do projeto: `KPICardEnhanced` já traz tilt 3D e a barra de benchmark.
Transições em `cubic-bezier(0.16,1,0.3,1)`. Nada de componente visual novo.

## 9. Permissão

Gate de UI com `RequireRole` (`src/components/auth/RequireRole.tsx`), aceitando `admin`
e `head`; super admin passa pela flag `is_super_admin`, como em todo o resto do sistema.

A segurança real é o RLS de `user_dashboards` e o RLS das tabelas que os hooks já
consultam. O painel não abre nenhum dado novo: ele só reorganiza números que o usuário
já podia ver nas telas de origem. Um `user` que forçasse a rota não conseguiria ler
painel de outro nem dado fora do tenant.

## 10. Fases

**F1 — Levantamento.** Percorrer os cinco dashboards, listar cada card e gráfico com
rótulo, origem, campo e `helpKey`, marcar os gráficos embutidos como `pending`, e
entregar a tabela para aprovação item a item. Sem código de produto.

**F2 — Catálogo e persistência.** `kpiCatalog.ts` preenchido com o resultado aprovado da
F1; migration da `user_dashboards` com RLS; hook `useUserDashboard` de leitura e escrita.

**F3 — Renderização.** Providers por área, contexto de filtro por seção, carga
preguiçosa, grade e renderização de card e gráfico. Aba nova no Dashboard com a barra
global condicional.

**F4 — Construtor.** Diálogo de montagem: seções, catálogo, busca, cota, arrastar.

**F5 — Gráficos próprios do painel.** Os ~22 gráficos hoje escritos dentro das abas
entram no painel como **componente novo, do painel**, lendo o mesmo campo do mesmo
provider — nunca extraindo código da aba de origem. A versão anterior desta fase
mandava refatorar as abas; foi descartada em 09/09/2026 pela restrição da §5.0.

O custo é duplicar código de desenho de gráfico. O ganho é que a aba de origem não
corre risco nenhum, e cada gráfico vira entrega independente: enquanto não tiver o
componente do painel, o item fica `pending` e aparece apagado no catálogo.

F1 a F4 entregam o módulo funcionando. F5 amplia o catálogo sem mexer no módulo.

## 11. Testes

- Catálogo: todo `id` é único; todo `helpKey` declarado existe em `kpiHelp`; todo
  `provider` declarado existe no mapa de providers.
- Layout: item com `id` desconhecido é ignorado sem derrubar a renderização; cota de 15
  é respeitada na gravação, não só na tela.
- Filtro por seção: duas seções da mesma área com filtros diferentes produzem duas
  consultas distintas e não compartilham cache.
- Período relativo: seção salva com `hoje` renderiza o dia da leitura, não o da gravação.
- Testes de componente com `createRoot` + `act`, conforme a convenção do repo — RTL não
  funciona aqui.

## 12. Riscos

**O levantamento é maior do que parece.** Rótulo na tela e chave no `kpiHelp` divergem em
vários casos e 67 verbetes não têm card. Resolver isso é decisão do owner, item a item,
e é por isso que a F1 termina numa tabela para aprovação em vez de emendar direto na F2.

**A seção Financeiro carrega o dashboard de receita inteiro.** Mitigado por carga
preguiçosa e com saída prevista (§5.4). Não é bloqueante para a entrega.

**Os hooks de CS, Implantação e Certificados A1 ainda não foram medidos.** O custo deles
sai na F1. Se algum tiver o mesmo perfil do `useDashboardData`, entra na mesma mitigação.

**Os contextos de filtro não foram escritos para conviver.** `AtendimentoFilterContext`
hoje é montado uma vez, no topo da página de Atendimento. Instanciar vários em paralelo
é uso novo. É o ponto da F3 que precisa de mais atenção, e o primeiro a ser provado com
teste.

## 13. Fora de escopo

Ordenar cards dentro da seção arrastando; duplicar seção; painel em modo TV; head
publicando painel para o time; painel padrão da empresa definido pelo admin; indicadores
do Painel de Uso; alerta ou meta configurável por card. Nenhum deles exige refazer o que
está aqui.
