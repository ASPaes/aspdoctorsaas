# Iniciar conversa: seleção de contato explícita e telefone com DDI correto

**Data:** 2026-07-26
**Arquivo alvo:** `src/components/tickets/StartConversationFromTicketDialog.tsx`
**Consumidores:** `SupportTicketDetailDialog.tsx` (2 pontos), `pages/onboarding/JourneyDetailSheet.tsx` (1 ponto)

## Problema

Ao abrir "Iniciar conversa" a partir de um ticket ou de uma jornada de onboarding e clicar no
botão sem escolher um contato, o usuário recebe `Telefone inválido` — uma mensagem que descreve
uma causa que não aconteceu. O telefone não é inválido; ele simplesmente não foi escolhido.

Causa direta, em `handleStart`:

```ts
const phone = mode === "client" ? selectedContactPhone : thirdPartyPhone.replace(/\D/g, "");
if (!phone || phone.length < 10) {
  toast.error("Telefone inválido");
  return;
}
```

Com `mode === "client"` e nenhum contato clicado, `selectedContactPhone` é `""` e cai no mesmo
ramo de erro do telefone malformado.

O agravante é visual: o card do contato não tem rótulo de seção, não tem indicador de rádio e
usa um ícone de telefone à esquerda. Ele lê como um card informativo do cliente, não como uma
opção clicável. O usuário não clica porque nada indica que deveria.

## Decisões tomadas

| Decisão | Escolha |
|---|---|
| Feedback de validação | Botão desabilitado enquanto faltar algo, com dica do que falta abaixo dele |
| Contato único | Pré-seleciona automaticamente |
| Correção de DDI no modo Terceiro | Entra na mesma entrega |

## Escopo

Um único arquivo de componente. Sem migration, sem edge function, sem RPC nova. A assinatura da
chamada `start_conversation_from_ticket` não muda.

## Mudanças

### A. Botão desabilitado + dica do que falta

Estado derivado por render, sem `useState` novo:

```ts
const needInstance = !instanceId;
const needContact  = mode === "client" && !selectedContactPhone;
const needPhone    = mode === "third_party" && !thirdPartyValid;
const canStart     = !needInstance && !needContact && !needPhone;
```

Frases (uma por combinação alcançável, verbo correto para cada campo):

| Situação | Texto |
|---|---|
| falta instância e contato | `Selecione a instância e o contato para continuar` |
| falta instância e telefone | `Selecione a instância e informe o telefone para continuar` |
| falta só instância | `Selecione a instância para continuar` |
| falta só contato | `Selecione o contato para continuar` |
| telefone vazio | `Informe o telefone para continuar` |
| telefone digitado mas inválido | `Telefone incompleto ou inválido` |

Os dois `toast.error` de validação (`"Selecione uma instância"` e `"Telefone inválido"`) são
removidos — passam a ser inalcançáveis. O `toast.error` do `catch` do RPC permanece: erro de
servidor continua sendo erro.

`handleStart` mantém um `if (!canStart) return;` defensivo no topo.

### B. Pré-seleção do contato único

`useEffect` no mesmo padrão do que já existe para a instância: com `open`, modo `client`,
nenhum contato selecionado e exatamente um contato disponível, seleciona esse contato.

No caso que originou este spec (cliente com um único contato), o dialog abre com o contato já
marcado e só a instância pendente.

### C. A lista de contatos passa a comunicar que é uma escolha

- Rótulo `Contato` acima da lista, com `Selecione um` alinhado à direita enquanto nada estiver
  selecionado.
- Indicador de rádio (círculo com borda; preenchido quando selecionado) no lugar do ícone de
  telefone à esquerda de cada card.
- O `Badge` "Selecionado" sai — vira redundante com o círculo preenchido e a borda `primary`.
- Container recebe `role="radiogroup"`; cada card recebe `role="radio"` e `aria-checked`.

### D. Telefone formatado no card

O número exibido passa por `formatBRPhone`: `5534991565512` vira `+55 (34) 99156-5512`.

### E. Filtro e normalização dos contatos

Na `queryFn`, cada telefone candidato passa por `normalizeBRPhone` antes de entrar na lista, e
só entra se `isValidBRPhone` aprovar. Consequências:

- Contato salvo como `34991565512` (sem DDI) passa a funcionar — hoje vai cru para o RPC.
- A deduplicação por telefone fica correta: o mesmo número salvo com e sem `55` deixa de
  aparecer duas vezes.
- Contato com telefone inválido não é oferecido, em vez de ser oferecido e falhar no envio.

O contador de descartados alimenta a mensagem do estado vazio (item F).

### F. Estado vazio com saída

Hoje `Nenhum contato com telefone cadastrado` é um beco sem saída: não há ação possível na tela
sem trocar de modo manualmente.

Passa a ser um bloco tracejado com a mensagem correta para cada caso —
`Nenhum contato com telefone cadastrado` quando o cliente não tem nenhum, ou
`Nenhum contato do cliente tem telefone válido cadastrado` quando existem mas foram descartados
no item E — mais um botão **Informar telefone manualmente** que alterna para o modo
Terceiro / Externo.

### G. DDI no modo Terceiro / Externo

O campo hoje inicializa com `"55"` e faz `e.target.value.replace(/\D/g, "")`. Colar o número
completo (`5534991565512`) produz `555534991565512` e o envio falha.

O `Input` cru é substituído por [`PhoneInputBR`](../../../src/components/ui/PhoneInputBR.tsx),
que já existe e é o componente canônico: máscara ao vivo `+55 (DD) 9XXXX-XXXX`, tratamento de
colar, e normalização apoiada em [`src/lib/phoneBR.ts`](../../../src/lib/phoneBR.ts) — que já
trata corretamente o caso do DDD 55 (Santa Maria/RS), desambiguado por contagem de dígitos.

O estado passa a guardar o valor mascarado; `normalizeBRPhone` é aplicado no envio e
`isValidBRPhone` (12–13 dígitos, DDD diferente de `00`) substitui o `length < 10` de hoje.
O valor inicial deixa de ser `"55"` e passa a ser `""`, aqui e no `resetForm`.

Isto elimina uma reimplementação local de regra que já tem fonte única no projeto — a mesma
classe de bug de DDI corrigida antes no importador de clientes.

## Acessibilidade

Botão desabilitado não recebe foco e é ignorado por leitores de tela. Mitigação: a dica é texto
visível permanente (não tooltip, não `title`), referenciada por `aria-describedby` no botão. A
lista de contatos vira um `radiogroup` propriamente anunciado.

## Fora de escopo

- Persistir a última instância usada por operador.
- Busca/filtro na lista de contatos (o volume por cliente é baixo).
- Qualquer mudança no RPC `start_conversation_from_ticket`.
- O mesmo bug latente de DDI em `supabase/functions/_shared/phone.ts` (backend, sensível a
  deploy — tratar separadamente).
- O bug de `maskBRPhoneLive` descrito abaixo.

## Bug pré-existente encontrado na verificação: `maskBRPhoneLive` ao digitar com DDI

Verificado em 2026-07-26 com a função real, encadeando a máscara caractere a caractere como o
`onChange` faz:

```
digitou 34991565512    -> "+55 (34) 99156-5512"  -> 5534991565512  ✅
colou   5534991565512  -> "+55 (34) 99156-5512"  -> 5534991565512  ✅
digitou 5534991565512  -> "+55 (55) 34991-5655"  -> 5555349915655  ❌
```

Causa: `maskBRPhoneLive` prefixa `55` sempre que o valor tem 10–11 dígitos. Quem digita o número
completo *com* DDI passa por esse comprimento no meio da digitação, o `55` é prefixado ali, e os
dígitos restantes entram deslocados. Colar não sofre porque a string chega inteira com 13
dígitos e nunca cruza a faixa 10–11.

O comentário na função afirma que o comprimento desambigua o DDD 55 do código de país. Isso vale
para entrada completa; não vale para entrada em progresso.

Não é regressão desta entrega — `maskBRPhoneLive` já se comportava assim. Atinge os 4
consumidores: `PhoneInputBR`, `EditContactModal`, `ContactDirectoryDialog`, `HorarioPlantaoTab`.
A máscara exibe o número errado na tela, então é detectável a olho, mas silencioso se o operador
não conferir.

Correção provável (não aplicada, precisa de decisão): parar de prefixar `55` durante a digitação
e deixar o `handleBlur` do `PhoneInputBR` — que já chama `normalizeBRPhone` — resolver o caso
nacional. Exige revisar os outros 3 consumidores, que gravam o valor mascarado.

## Verificação

Contra o banco local (`.env.local`), no dialog aberto a partir de um ticket e de uma jornada:

1. Cliente com 1 contato → contato já vem marcado; dica pede só a instância.
2. Cliente com 2+ contatos → nada marcado; dica pede instância e contato; botão desabilitado.
3. Selecionar contato e instância → botão habilita, dica some.
4. Cliente sem contato válido → bloco tracejado com o botão de telefone manual; o botão alterna
   para Terceiro / Externo.
5. Modo Terceiro: colar `5534991565512` e digitar `34991565512` produzem o mesmo envio.
6. Modo Terceiro com telefone parcial → `Telefone incompleto ou inválido`, botão desabilitado.
7. Em nenhum caminho aparece `Telefone inválido` sem que um telefone tenha sido digitado.
