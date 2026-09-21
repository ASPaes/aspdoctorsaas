---
description: Publica o que está pendente em produção e registra a entrega no AtualizacoesDS.md, na ordem certa
argument-hint: "[o que foi entregue, opcional]"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# /publicar

Publica o trabalho pendente e registra no `AtualizacoesDS.md`. Executa tudo sem pedir
aprovação intermediária. As únicas paradas são as travas duras da seção 6 — elas existem
porque o custo de errar ali é produção fora do ar, não incômodo.

Contexto do usuário, se ele escreveu algo depois do comando: **$ARGUMENTS**

---

## Por que este comando existe

Duas pessoas (Alexandre e Vinicius) escrevem no mesmo `AtualizacoesDS.md`, cada uma na
sua máquina, e o Lovable commita na mesma `main` sem avisar. Em 20/09/2026 as duas cópias
locais estavam atrás do GitHub — uma parada em 13/09, outra em 17/09, enquanto a versão
real já tinha 20/09 e 1.332 linhas. Os dois estavam lendo arquivo morto e teriam escrito
entradas que se perderiam no conflito seguinte.

A ordem **sincronizar → escrever → commitar → empurrar** é o conteúdo deste comando.
Não é burocracia: é a única ordem em que a entrada do outro não some.

---

## 1. Sincronizar antes de olhar qualquer coisa

```bash
git rev-parse --abbrev-ref HEAD            # confirmar que é main
git stash push -u -m "publicar-$(date +%Y%m%d%H%M)"   # só se houver coisa não commitada
git pull --rebase origin main
git stash pop                               # só se você stashou
```

Depois do pull, **releia o `AtualizacoesDS.md`**. O que você tinha em contexto antes do
pull está velho — o mês, o dia e as entradas podem ter mudado.

Se o `pull --rebase` conflitar no `AtualizacoesDS.md`: as duas entradas valem, nunca
escolha um lado. Mantenha as duas, a sua embaixo da que já estava lá, e siga.

Se o rebase conflitar em código, pare e resolva com o usuário — aí não é mais publicação,
é merge.

## 2. Descobrir o que está sendo publicado

```bash
git log --oneline origin/main..HEAD         # commits ainda não empurrados
git status --porcelain                      # trabalho não commitado
git diff origin/main --stat                 # tamanho real da entrega
```

Leia o diff de verdade, não só os nomes dos arquivos. A entrada tem que descrever o que
**mudou para o usuário**, e isso só sai do código.

Se não houver nada pendente, diga isso em uma linha e pare. Não invente entrega.

## 3. Escrever a entrada no `AtualizacoesDS.md`

Escreva direto, sem perguntar. O usuário pediu explicitamente que fosse automático.

**Onde:** no topo, sob o dia de hoje em `America/Sao_Paulo` (`TZ=America/Sao_Paulo date +%d/%m`).
Se a seção `### DD/MM` de hoje não existir, crie-a **acima** da mais recente. Se o mês
virou, crie `## <Mês> / <Ano>` acima também. Entrada nova de um mesmo dia vai no topo
daquele dia.

**Formato**, idêntico ao que já está no arquivo:

```
- 🔧 **Título curto do que o usuário percebe** — Explicação em linguagem de cliente.
```

**Classificação:** 🆕 Novidade (não existia) · ⬆️ Melhoria (existia e ficou melhor) ·
🔧 Correção (existia e estava errado).

**Como escrever o texto** — siga o tom das entradas que já estão no arquivo:

- Linguagem de cliente. Nada de nome de arquivo, tabela, função, hook ou commit.
- Diga **onde na tela** fica, no caminho do menu: "Em **Configurações › Atendimento › Canais**...".
- Para correção, comece pelo **sintoma que a pessoa via**, depois o que passa a acontecer.
- Número medido que você apurou entra; número inventado, nunca.
- Só o que o usuário percebe. Refactor, teste, migration, índice e ajuste interno **não entram** —
  ficam no histórico do Git.

Se a entrega não tem nada perceptível pelo usuário, **não force uma entrada**: publique
sem registrar e diga numa linha que não houve nada visível para registrar.

## 4. Commitar

A entrada e o código vão **no mesmo commit** sempre que possível. Entrada em commit
separado é o que permite publicar e esquecer de registrar.

Mensagem no padrão do repo: `tipo(escopo): descrição em minúsculas, sem acento`
(`fix`, `feat`, `docs`, `refactor`, `chore`). Corpo explicando o porquê quando couber.

Termine a mensagem com:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

Nunca use `git add -A` — outras sessões e worktrees compartilham este repo. Adicione os
caminhos que você mesmo mexeu, um a um.

## 5. Empurrar

```bash
git push origin main
```

Se o push for rejeitado, alguém empurrou enquanto você trabalhava: volte ao passo 1
(`pull --rebase`) e empurre de novo. Nunca `push --force` na `main`.

## 6. Travas duras — as únicas paradas permitidas

**Nenhuma delas é pedido de aprovação. São condições em que publicar quebra produção.**

- **`supabase/functions/_shared/**` no diff** → o CI deploya **todas as 87 edge functions**,
  e o repo não é fonte de verdade delas. **Pare.** Rode `./scripts/auditar-edge-functions.sh`
  antes e depois do push, conforme o `CLAUDE.md`. Sem baseline atualizado, o que o deploy-all
  reverter é impossível de descobrir depois.
- **Edge function nova entrando no repo** → confira o `verify_jwt` em produção
  (`supabase functions list --project-ref vbngjzovjhkmietztffo`) e **declare o valor no
  `supabase/config.toml`**, mesmo que seja `true`. Sem a entrada, o CI deploya com `false`
  e muda a autenticação em silêncio.
- **Não está na `main`** → pare e pergunte qual é a intenção.
- **O rebase conflitou em código** → pare. Isso é merge, não publicação.

Fora dessas quatro, siga até o fim sem perguntar nada.

## 7. Conferir que foi ao ar

```bash
git log --oneline origin/main -3
gh run list --limit 3
```

O deploy do frontend (`deploy-frontend-hostinger.yml`) **ignora `**.md`** — commit só de
`AtualizacoesDS.md` não dispara build, e isso é esperado, não falha.

Falha de FTPS com `ETIMEDOUT` é conhecida e o workflow já repete até 3x. Run cinza
(cancelada) também não é falha: `cancel-in-progress` mata a run anterior quando duas
saem quase juntas.

## 8. Fechar

Uma resposta curta: o que foi publicado, a entrada que entrou no `AtualizacoesDS.md`, e o
estado da Action. Sem relatório longo.
