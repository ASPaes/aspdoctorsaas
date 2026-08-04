# Anexos do onboarding: título, busca e log de autoria

**Data:** 02/08/2026
**Área:** Onboarding & Implantação → seção Anexos da jornada
**Status:** design aprovado, implementação pendente

## Problema

A seção Anexos da jornada não é própria: ela reusa o componente `TicketAttachments` do
Suporte (`src/components/tickets/TicketAttachments.tsx`), apontando para
`journey.ticket_id` (`src/pages/onboarding/JourneyDetailSheet.tsx:2834`).

Hoje esse componente mostra apenas nome do arquivo, tamanho e data. Disso vêm três lacunas:

1. **O nome do arquivo não descreve o conteúdo.** `WhatsApp Image 2026-07-14 at 09.31.jpeg`
   não diz o que é. Sem uma descrição do próprio operador, o anexo só é identificável abrindo.
2. **Não dá para procurar.** A jornada maior em produção tem 12 anexos; a média é 3,6.
   Achar "o contrato" numa lista de 12 nomes crus é leitura linha a linha.
3. **Não se sabe quem anexou.** A coluna `uploaded_by` é gravada desde sempre, mas nunca
   chegou à tela. E a exclusão não deixa rastro nenhum: o anexo simplesmente some.

Medido em produção (02/08/2026): 129 anexos no total, 58 deles em 16 jornadas de onboarding.

## Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Escopo | Só o Onboarding | O componente é compartilhado com o Suporte; mudar o fluxo de quem abre ticket todo dia não estava em questão. |
| Título | **Opcional**, pedido no upload, editável depois | Há 129 anexos já existentes sem título; travar o upload por causa disso pararia a operação. |
| Backfill dos existentes | Nenhum | Copiar `file_name` para `title` produziria 129 títulos que não descrevem nada e esconderia quais faltam de fato. |
| Busca | Dentro da seção de anexos daquela jornada | Foi o pedido; e é client-side, sem consulta nova ao banco. Busca global entre jornadas fica para outra entrega. |
| Log | Autoria no card **e** evento na Timeline | Autoria no card responde "quem foi" sem trocar de aba; a Timeline preserva o histórico de anexos já excluídos. |
| Edge functions | Não tocar | Qualquer commit em `supabase/functions/**` redeploya as 63 functions do repo (ver CLAUDE.md ⚠️ nº 1). Todo o comportamento novo cabe no front + RLS existente. |

## Modelo de dados

Uma coluna, aditiva, nullable:

```sql
ALTER TABLE public.support_ticket_attachments ADD COLUMN title text;
```

- Nullable e sem default: `NULL` significa "ainda sem título" e é o que aciona o selo na UI.
- Nome em inglês por consistência com a tabela (`file_name`, `file_size`, `uploaded_by`).
- Sem índice: a busca é client-side sobre a lista já carregada.
- Sem alteração de RLS. A policy existente `ticket_attachments_all` é `ALL` por tenant
  (`tenant_id IN (profiles do usuário) OR is_super_admin()`), então `UPDATE` do título já
  passa para qualquer usuário do tenant.

## Componente

`TicketAttachments` ganha uma prop:

```ts
interface Props {
  ticketId: string;
  tenantId: string;
  variant?: "ticket" | "onboarding";   // default "ticket"
}
```

`variant="onboarding"` liga, em conjunto: campo de título no upload, edição de título,
busca, autoria no card e gravação na Timeline. `SupportTicketDetailDialog.tsx:1370`
não passa nada e continua idêntico ao que é hoje.

Uma prop e não três booleanos: os quatro comportamentos só fazem sentido juntos, e
`variant` deixa claro no ponto de uso qual tela está sendo configurada.

### 1. Anexar

Fluxo atual: `<input multiple>` → upload imediato via XHR para a edge function
`upload-ticket-attachment`, um arquivo por vez, com barra de progresso.

Fluxo novo (só no `variant="onboarding"`):

1. Usuário escolhe os arquivos.
2. Abre um diálogo listando cada arquivo (ícone, nome, tamanho) com um campo
   `Título (opcional)`, `placeholder` = nome do arquivo sem extensão.
3. `Enviar` sobe todos, um a um, com a barra de progresso de hoje.
4. Para cada upload bem-sucedido **com** título preenchido, um `UPDATE` grava o título.

O `UPDATE` pós-upload é o que evita mexer na edge function. `uploadOne()` passa a
retornar o `id` da linha — a EF já devolve `{ success, id, path }` no corpo, ele só
é descartado hoje. É o mesmo caminho de código da edição, então existe uma única
função de gravação de título.

Se o `UPDATE` falhar, o anexo permanece sem título e o usuário edita depois — nenhum
arquivo é perdido por causa disso. O título vazio é um estado válido, não um erro.

`Cancelar` no diálogo descarta a seleção sem subir nada.

### 2. Editar título

Botão de lápis no item abre um campo inline (`Enter` salva, `Esc` cancela) e grava
o mesmo `UPDATE`.

Quem pode editar: **a mesma regra que já governa a exclusão** —
`is_super_admin || role === "admin" || role === "head"` em qualquer anexo; os demais
apenas nos que eles mesmos subiram (`uploaded_by === user.id`).

Isso é gate de tela, não de segurança: a policy de RLS libera `UPDATE` para qualquer
usuário do tenant. A mesma assimetria já existe na exclusão, com a diferença de que lá
a regra é repetida na edge function. Reusar a regra evita criar um segundo modelo mental
de permissão dentro da mesma lista; endurecer no banco fica para o esforço de RBAC
backend, que é transversal.

### 3. Buscar

Campo com ícone de lupa no cabeçalho da seção, visível a partir de **2 anexos**.

Filtra a lista já carregada, sem ida ao banco, casando o termo contra:

- `title`
- `file_name`
- a **extensão** derivada de `file_name` (trecho após o último ponto) — digitar `pdf`
  traz os PDFs

Comparação normalizada: minúsculas e sem acento, nos dois lados —
`s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()`, a mesma normalização
que a edge function de upload já aplica ao nome do arquivo.

Enquanto há termo digitado, o contador ao lado do título da seção mostra `3 de 12`.
Sem resultado: `Nenhum anexo corresponde a "xyz"` com ação de limpar.

`file_type` guarda o mimetype (`application/pdf`), por isso a extensão sai do nome do
arquivo, não dele.

### 4. Card do anexo

```
[PDF]  Contrato assinado                (editar)(ver)(baixar)(excluir)
       contrato_assinado.pdf · 1.2MB
       Alexandre · 02/08 14:32
```

Sem título, o nome do arquivo ocupa a primeira linha, acompanhado do selo `sem título`,
e a segunda linha mostra só o tamanho.

O nome do autor sai de `uploaded_by` (auth user id) por
`profiles.user_id → profiles.funcionario_id → funcionarios.nome`, o mesmo caminho que a
Timeline da jornada já usa (`JourneyDetailSheet.tsx:624-650`). Sem funcionário vinculado,
exibe `Usuário`.

Essa resolução vira um hook próprio, `src/hooks/useUserNames.ts`, recebendo a lista de
user ids e devolvendo `Record<string, string>`:

- sem filtro de `tenant_id` na consulta a `profiles` — com o filtro, o super admin
  simulando outro tenant não resolve o próprio nome; o RLS de `profiles` é quem limita
- `queryKey: ["user-names", ids.sort().join(",")]`

`JourneyDetailSheet` **não** é refatorado para consumir o hook nesta entrega. O arquivo
tem mais de 3.000 linhas e é editado em paralelo pelo Lovable; a duplicação de ~25 linhas
custa menos que o conflito.

## Timeline

Dois tipos de evento novos em `support_ticket_events`:

| `event_type` | Rótulo | Ícone / cor |
|---|---|---|
| `onboarding_anexo_adicionado` | Anexo adicionado | `Paperclip` / emerald |
| `onboarding_anexo_removido` | Anexo excluído | `Paperclip` / red |

`content`: `Contrato assinado (contrato_assinado.pdf)`; sem título, apenas
`contrato_assinado.pdf`.

Gravação pelo próprio componente, logo após o upload ou a exclusão retornarem sucesso —
o mesmo padrão dos eventos de onboarding que já existem
(`JourneyDetailSheet.tsx:1410`, `:1464`):

```ts
supabase.from("support_ticket_events" as any).insert({
  tenant_id, ticket_id, user_id: user.id, event_type, content,
});
```

A policy `ticket_events_insert` permite o insert por tenant. Depois de gravar,
invalidar `["onboarding-ticket-events"]` para a aba Timeline refletir na hora.

**Um evento por arquivo.** Anexar 5 prints de uma vez gera 5 linhas — é o que permite
casar cada entrada com a exclusão correspondente, que é sempre individual.

`TL_META` em `JourneyDetailSheet.tsx:160` ganha as duas entradas, e `Paperclip` entra no
import de ícones (hoje ausente no arquivo).

### Limite assumido

O registro é best-effort: se o insert do evento falhar, o anexo sobe ou some sem linha na
Timeline. É exatamente a garantia que os eventos de onboarding têm hoje.

Fechar essa brecha exigiria trigger no banco, e trigger **não resolve a exclusão** — ela
passa pela edge function `delete-ticket-attachment` com `service_role`, onde `auth.uid()`
é nulo e a linha já foi apagada, então não há de onde tirar quem excluiu. Um mecanismo
que cobrisse só metade dos casos custaria mais do que entrega.

## Testes

`@testing-library/react` está quebrado no repo (falta o peer `@testing-library/dom`;
importar derruba a suíte inteira e o `tsc`). Os testes usam `createRoot` + `act` com o
client do Supabase mockado, como `EditJourneyInfoDialog.test.tsx`.

Cobertura, em `src/components/tickets/TicketAttachments.test.tsx`:

1. Busca por título, por nome de arquivo e por extensão (`pdf`), inclusive com acento e
   caixa trocada no termo.
2. Busca sem resultado mostra o vazio e o contador `0 de N`.
3. Campo de busca não aparece com 1 anexo; aparece com 2.
4. Anexo sem título exibe nome do arquivo na 1ª linha e o selo `sem título`.
5. Lápis de edição some para o operador comum em anexo de outra pessoa e aparece no
   próprio.
6. `variant` ausente (Suporte) não renderiza busca, título, autoria nem lápis.

Verificação de tipos: `npx tsc -p tsconfig.app.json` — `tsc` na raiz não checa nada
(`files: []`).

## Fora de escopo

- **Busca global de anexos** entre jornadas. Precisaria de tela, índice e regra de
  unidade; é outra entrega.
- **Título no Suporte.** A prop deixa isso a um argumento de distância quando ele quiser.
- **Endurecer no banco quem edita o título.** Segue a mesma condição da exclusão: RLS
  liberado por tenant, regra na UI.
- **Refatorar `JourneyDetailSheet` para usar `useUserNames`.**

## Aplicação

1. `ALTER TABLE` no Docker local; conferir a coluna.
2. Front no local, contra a base local, com os testes e o `tsc`.
3. Mostrar para o Alexandre.
4. Com o OK: coluna em produção via `apply_migration` e push do front (deploy Hostinger
   automático). Nenhum arquivo em `supabase/functions/**` é tocado, então o workflow de
   edge functions não dispara.
5. Ao publicar, uma linha no `CHANGELOG.md` (⬆️ Melhoria).
