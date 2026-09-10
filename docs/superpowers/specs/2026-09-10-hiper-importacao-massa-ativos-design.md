# Importação em massa de contas ativas do Hiper

**Data:** 10/09/2026 · **Tenant medido:** ASP · **Pull de referência:** 10/09/2026 13:00 UTC

Trazer para o DoctorSaaS, em lote, as contas que vivem no portal Hiper e não
têm cadastro aqui. Só as **ativas**. Cancelado fica para uma v2.

---

## 1. Por que isso existe

Hoje a importação já funciona, mas foi desenhada para punhado: cada conta vira
um cartão com cinco campos e três deles são obrigatórios. Para as 3 contas
pendentes da ASP isso serve. Para uma revenda nova entrando com centenas de
contas ativas, não serve — e é esse o caso que o recurso atende.

O ganho imediato, mesmo com 3 contas, é outro: **a tela pede à mão o que o
portal já entregou.**

---

## 2. O que já existe — medido, não suposto

### `hiper_importar_contas(p_tenant_id, p_padrao, p_itens)`

Está pronta para lote de ativos e **não precisa ser trocada**:

- recebe `p_itens` como array e já tem **teto de 200 por chamada**, com mensagem
  própria pedindo para dividir o lote;
- monta cliente, produto, contrato, custo e módulos pela função canônica
  `create_cliente_produto_with_contract`;
- deriva a recorrência do **nome do plano** (`anual`/`semestral`/`semanal`),
  espelhando `recorrenciaDoPlano` no frontend;
- revalida no banco: conta fora da reconciliação, conta que ganhou dono entre a
  tela e o clique, CNPJ vazio, CNPJ já cadastrado, plano ou tipo não mapeados —
  cada uma vira **recusa com motivo**, sem derrubar o lote;
- grava `hiper_alteracao_log` com `lote_id`, o que já dá `hiper_reverter_lote`;
- reconcilia **uma vez no fim**, não por conta.

### A guarda que já protege o escopo

As 358 contas inativas sem dono têm **`divergencias = {}`** — nenhuma delas
carrega `sem_dono` como divergência. Elas não aparecem na lista (`linhas` filtra
`divergencias.length > 0`) e, se chegassem, a RPC recusaria pelo teste
`if not ('sem_dono' = any(divergencias))`.

**Ou seja: a v1 é estruturalmente incapaz de importar cancelado.** Não é preciso
construir trava nenhuma para isso.

### O espelho já tem contato

| Campo | Preenchimento em 998 contas |
|---|---|
| `email` / `contato_email` | **998/998**, 946 distintos, **100% em formato válido** |
| `telefone` / `contato_telefone` | **998/998**, 958 distintos, 997 com 10–11 dígitos |

E a tela obriga a digitar os dois, conta a conta.

---

## 3. Os números que definem o desenho

### Contas ativas, por tipo de contrato (998 do espelho)

| Tipo | Ativas | Com MRR no portal | Sem MRR | Com custo |
|---|---|---|---|---|
| **Hiperador** (`hiper`) | 352 | **0** | 352 | 346 |
| Central de Cobrança | 113 | 108 | **5** | 108 |
| Central de Leads | 155 | 141 | **14** | **0** |

Três leituras que mandam no desenho:

1. **Hiperador nunca tem valor** — 0 em 352, sem exceção. Nessas contas quem
   cobra o cliente é a revenda; o portal só conhece o custo.
2. **Central quase sempre tem** — mas **19 ativas não têm**. Uma faixa
   automática que assuma o valor presente criaria 19 clientes com R$ 0,00 de
   receita e custo saindo.
3. **Central de Leads tem custo zero em 155/155.** O custo do lote vem só de
   Hiperador e Cobrança.

### Sem dono hoje na ASP

3 contas ativas pendentes (2 Hiperador, 1 Central de Leads) e 1 ignorada.
358 inativas, fora de escopo.

### Catálogo não trava

361/361 das contas sem dono têm plano **e** tipo mapeados na aba Módulos — são
só 4 planos distintos. Num tenant novo, mapear o catálogo é **pré-requisito** da
carga, não parte dela.

---

## 4. Regra: duas faixas, decididas pelo tipo de contrato

### Faixa automática — Central (Cobrança e Leads) **com** valor no portal

Nada a digitar por conta:

| Campo | Vem de |
|---|---|
| Mensalidade | `mrr` do portal |
| E-mail | `email` → `contato_email` |
| WhatsApp | `telefone` → `contato_telefone` |
| Custo, plano, tipo, recorrência, cidade/UF | já vêm hoje |

Seleciona tudo e importa. Todos os campos seguem editáveis.

### Faixa manual — Hiperador **+** as Central sem valor

Lista de trabalho com uma coluna editável: **mensalidade**. Preenche quem sabe,
marca e importa. Quem foi importado **some da lista sozinho** — a reconciliação
deixa de vê-lo como sem dono — então voltar depois e continuar de onde parou
funciona sem guardar rascunho.

**Decidido: não guardar rascunho na v1.** O que for digitado e não importado na
mesma sessão se perde ao recarregar. Guardar pediria tabela nova, e o ciclo
natural é preencher um punhado e importar. É aditivo depois, se incomodar.

### O que separa as faixas

Não é o tipo sozinho: é **tipo + presença de valor**. Uma conta de Central sem
`mrr` cai na faixa manual junto com as de Hiperador. A tela precisa dizer isso
na cara, não classificar em silêncio.

---

## 5. Tela

Substitui o cartão-por-conta por tabela quando o lote passa de ~10 contas; abaixo
disso o cartão de hoje continua melhor e fica.

**Topo — vale para o lote inteiro** (o que já existe): unidade base*, data de
início*, origem, vendedor, forma de pagamento, dia de vencimento.

**Duas seções, na ordem em que se trabalha:**

1. **Pronta para importar (N)** — a faixa automática. Tabela: razão social,
   CNPJ, plano, tipo, mensalidade (do portal), custo, e-mail, WhatsApp. Uma
   caixa "selecionar todas".
2. **Falta a mensalidade (N)** — a faixa manual. Mesma tabela, com a mensalidade
   como campo aberto. O botão importa **só as linhas preenchidas e marcadas**, e
   diz quantas ficaram.

**Marcações obrigatórias na tabela:**

- **Telefone fixo.** Só **520 dos 998** telefones do espelho são celular; os
  outros 478 são fixo indo para um campo chamado WhatsApp. A linha precisa
  marcar isso — esconder seria mentir sobre um dado que o operador vai usar para
  falar com o cliente.
- **Conta de Central sem valor**, para a pessoa entender por que aquela linha
  não está na faixa automática.

---

## 6. Envio

- Quebrar em chamadas de **200**, o teto que a RPC já impõe.
- Barra de progresso por chamada ("lote 2 de 5").
- Acumular `criados` e `recusados` de todas as chamadas num resumo único. O
  recusado importa tanto quanto o criado — sem ele a pessoa acha que importou
  800 e importou 780.
- **Uma chamada que falha não cancela as seguintes.** Cada chamada é sua própria
  transação e tem seu `lote_id`; o resumo diz qual falhou.
- Invalidar `hiper_recon`, `hiper_log` e `clientes` só no fim, não a cada
  chamada.

---

## 7. Validações

| Regra | Onde | Por quê |
|---|---|---|
| Mensalidade **> 0** | tela | Hoje `numeroOk` aceita 0 e a RPC só recusa negativo. Zero é exatamente o "cliente sem receita com custo saindo" que a obrigatoriedade existe para impedir. |
| E-mail em formato válido | tela + RPC | Já existe nas duas. O do espelho passa em 998/998. |
| WhatsApp ≥ 10 dígitos | tela + RPC | Já existe. 997/998 do espelho passam. |
| Unidade base e data de início | tela + RPC | Já existe. |

**Exceção conhecida em aberto:** cliente em cortesia legítima (R$ 0,00). Na v1
ele não entra pelo lote — cadastra pela ficha. Se aparecer volume disso, vira
uma marcação explícita "sem cobrança", nunca um zero digitado no meio dos
outros.

---

## 8. Fora de escopo, com motivo

### Cancelados — v2

Bloqueio real, não preguiça: **o portal não manda data de início.**
`cliente_desde` chega com a chave presente e valor `null` em **998/998**, e não
existe em nenhum outro campo nem no `raw`. Sem data de início, um cancelado
nunca teve base em mês algum — lançar o churn dele criaria **saída sem entrada**
e a ponte de MRR daquele mês fecharia com resíduo.

Quando for a hora, a decisão já tomada é: **cancelado entra como ficha
histórica, nunca como movimento** — cadastro, produto e contrato já encerrados
na `cancelada_em` do portal, com `contrato_eventos`, **sem** `movimentos_mrr`.
Isso exige caminho próprio: `cancelar_contrato` **sempre** insere um movimento
`churn`, não tem como pedir que não insira.

Insumos que já existem para a v2: `cancelada_em` e `cancelada_por` em **358/358**.
O que falta é preço — só **97 dos 358** têm qualquer vestígio de valor.

### `cliente_desde` no portal — não é trabalho daqui

A edge function `hiper-integration-call` **já lê** `c.cliente_desde` (linhas 295
e 498) e o contrato da API o declara em `docs/integracao-hiper-campos-de-cadastro.md`.
Quem não preenche é o portal. Que ele sabe lidar com data está provado:
`ultimo_acesso` vem em 983/998 e `cancelada_em` em 360/360 dos cancelados.

**Isso afeta a v1 também.** Sem `cliente_desde`, uma carga de tenant novo entra
com todo mundo começando no dia da importação — tempo de casa, coorte e série de
MRR nascem errados. Vale corrigir o portal **antes** da primeira carga grande.

### `situacao = 'bloqueado'`

18 contas no espelho numa terceira situação. Hoje nenhuma aparece como sem dono,
mas pode aparecer num tenant novo. **Não decidido.** Quando surgir, decidir se
entra como ativa ou fica de fora — não deixar cair no caminho de ativa por
omissão.

---

## 9. Riscos e o que falta medir

1. **Timeout.** `hiper_importar_contas` chama `hiper_importar_modulos`
   **conta a conta**, em laço, dentro da mesma transação. Com 200 contas isso
   pode estourar o tempo. **Medir com lote real antes de fixar o tamanho da
   chamada** — se estourar, o teto efetivo da tela cai (50, 100) sem tocar na
   RPC.
2. **`hiper_reconciliar` no fim de cada chamada.** Varre a carteira inteira. Com
   5 chamadas são 5 varreduras. Aceitável; medir o tempo.
3. **Carga grande em tenant novo é escrita em massa em `clientes`,
   `cliente_produtos`, `contratos` e `contrato_itens`.** Rodar fora do pico.

---

## 10. Testes

**Unitários (Vitest), no padrão de `importarRegras.test.ts`:**

- separação em faixas: Hiperador sempre manual; Central com valor → automática;
  Central sem valor → manual.
- contato do espelho: `email` vazio cai para `contato_email`; idem telefone.
- detecção de fixo (10 dígitos) versus celular (11).
- mensalidade 0 bloqueia a linha.
- quebra em chamadas: 450 linhas → 3 chamadas (200, 200, 50).

**No banco local, com dados reais:**

- lote de 200 ativas: mede tempo e confirma que `hiper_importar_modulos` não
  estoura.
- lote com uma conta de CNPJ já cadastrado: confirma que ela vira recusa e as
  outras entram.

---

## 11. Ordem de entrega

1. **Contato vindo do espelho** — sozinho já muda a importação de hoje, vale
   para as 3 contas da ASP e é o pedaço barato.
2. **Faixas + tabela + envio em chamadas de 200.**
3. **Medição de timeout** e ajuste do teto efetivo.
