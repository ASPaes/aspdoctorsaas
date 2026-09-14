# RBAC v2 — o que foi construído e como testar

> Construído na madrugada de **14/09/2026**. Tudo aplicado **apenas no banco local**.
> **Produção não foi tocada** — nenhuma migration aplicada, nenhum deploy.

---

## Em uma frase

Os três papéis viraram grupos editáveis e duplicáveis, cada módulo ganhou um nível de controle (1/2/3), e o motor novo está ligado **só em ASP e Digi Office** — com prova de que nenhum dos 113 usuários mudou de acesso.

---

## Como subir

```bash
cd ~/Desenvolvimento/Projetos/DoctorSaaS-rbac
bun run dev        # aponta para o Docker local (.env.local)
```

Vá em **Configurações › Equipe › Permissões e papéis**.

- Com a empresa **ASP** ou **Digi Office** selecionada → tela nova (grupos e níveis).
- Com **qualquer outra** → tela antiga, intocada. É assim que se prova a condição C3.

---

## Roteiro de teste — 8 itens

| # | O que fazer | O que tem que acontecer |
|---|---|---|
| 1 | Trocar a empresa entre ASP e uma terceira | ASP mostra grupos; a outra mostra a matriz antiga |
| 2 | Em **Clientes**, clicar no nível **3** | Sai de 5 para 15 itens. Aparecem Contratos, Cancelar, Reajuste, Excluir tudo, Filiais, Contatos |
| 3 | Liberar **Clientes** e negar **Custos e margens**; voltar ao nível **1** | O diálogo lista o que sai e diz "fica bloqueado". Confirmar **não** libera Custos |
| 4 | Desmarcar **Clientes** no grupo Operador | Os filhos caem junto (cascata) |
| 5 | No grupo **Administrador**, tentar desmarcar **Permissões e papéis** | Cadeado; não deixa. Mensagem de anti-lockout |
| 6 | Digitar um nome e clicar **Duplicar "Operador"** | Grupo novo aparece com as mesmas regras |
| 7 | Procurar a marca **"ainda não aplicado"** | Aparece em 18 recursos — os que ainda não têm portão no código |
| 8 | Abrir **Dashboard de Atendimento** como usuário comum | Continua bloqueado (o `RequireRole` saiu, mas a permissão foi gravada) |

---

## A prova de que nada mudou

Rodada com o motor novo ligado, **chamando `get_my_permissions()` como cada um dos 113 usuários** — não uma réplica da lógica:

```
linhas comparadas ....... 7.458
sumiu ................... 0
apareceu ................ 0
```

Para repetir:

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -c "
  select rbac_test.capturar('agora');
  select (select count(*) from (select * from rbac_test.antes except select * from rbac_test.agora) x)
       + (select count(*) from (select * from rbac_test.agora except select * from rbac_test.antes) x) as diff;"
```

**Diff tem que ser 0.**

### A única exceção, e ela é deliberada

A migration `20260914050000` (bug B5) muda **14 linhas de propósito**: os 14 usuários `user` da Digi Office perdem `nav.atendimento_dashboard`.

Motivo: a rota tinha portão duplo. Tirar o `RequireRole` sem isso daria a eles as abas **Agentes** (produtividade individual) e **Satisfação** (nota individual). Medido: nenhum outro tenant libera esse recurso para `user`.

⚠️ **Essa migration e a remoção do `RequireRole` são a mesma entrega.** Uma sem a outra quebra: sozinha, ela tira um menu que hoje não abre; o frontend sozinho abre a tela para 14 pessoas.

---

## Testes automatizados

```bash
# 10 testes das guardas (roda em transação, dá rollback sozinho)
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres \
  < scripts/sql-tests/30_rbac_v2.sql
```

Resultado atual: **10 passaram, 0 falharam** — cascata, anti-lockout, rebaixar nível, duplicar, exclusão de grupo base, um-grupo-por-pessoa, grupo com membros, operador sem poder editar, escopo, e `has_perm` ainda dormente.

Frontend: `bunx vitest run` → **971 de 972 passam**. As 2 falhas (`CsatReportModal.tsx`, `MacroDialog.tsx`) são **anteriores** a este trabalho — arquivos que não foram tocados.

`tsc -p tsconfig.app.json` limpo · `vite build` em 6,19s.

---

## O catálogo

**138 itens, organizados igual ao menu lateral** — a lista completa, com o caminho de cada um, está no início de `RBAC_FUNCTIONALITIES.md`.

| Nível | Itens | O que é |
|---|---|---|
| 1 — Normal | 42 | A tela de hoje: entradas do menu + Configurações |
| 2 — Moderado | 37 | Portas de módulo e ações sensíveis (dinheiro, LGPD, irreversível) |
| 3 — Completo | 59 | Abas e sub-ações |

⚠️ **72 dos 138 ainda não têm portão no código** e aparecem com "ainda não aplicado". Isso é esperado: o catálogo é o vocabulário completo do produto; ligar cada portão é a F3.

## Os arquivos

**Migrations** (nenhuma aplicada em produção):

| Arquivo | O que faz |
|---|---|
| `20260914010000_rbac_v2_estrutura.sql` | flag `rbac_v2_enabled`, 10 módulos normalizados, `nivel` nos recursos, tabelas de grupo |
| `20260914020000_rbac_v2_semeadura_e_motor.sql` | 42 grupos-semente, 1.782 regras copiadas, 112 vínculos, `get_my_permissions` com desvio pela flag |
| `20260914030000_rbac_v2_rpcs.sql` | 7 RPCs de administração + anti-lockout + RLS das tabelas novas |
| `20260914040000_rbac_v2_has_perm_dormente.sql` | `has_perm` / `perm_scope` / `my_departments` — prontas, **nenhuma policy usa** |
| `20260914050000_rbac_v2_fix_dashboard_atendimento.sql` | bug B5 — ver acima |

**Frontend:**

- `src/hooks/useRbacConfig.ts` — leitura e mutações
- `src/components/configuracoes/permissoes/GruposPermissoesContent.tsx` — a tela
- `src/components/configuracoes/PermissoesPapeisContent.tsx` — desvia pela flag (C3)
- `src/App.tsx` — `RequireRole` removido de `/atendimento/dashboard`

---

## Duas coisas que mudaram por causa do que o banco mostrou

**1. `user_groups` referencia `profiles`, não `auth.users`.**
Produção tem **6 profiles cujo `user_id` não existe em `auth.users`**. Com FK para `auth.users`, a migration **falha em produção**. O local pegou isso antes — foi o primeiro erro da noite.

**2. O `viewer` do ASP ficou sem grupo, de propósito.**
Ele hoje recebe `false` em tudo (está `inativo`). Dar um grupo a ele seria mudança. Sem grupo, o motor novo cai no mesmo `false` de sempre. Consertá-lo é decisão sua, separada.

---

## Para publicar (quando você decidir)

Ordem obrigatória:

1. Rodar a foto **ANTES** em produção (query na seção 5-A do plano de desenvolvimento).
2. Aplicar `010000` → `020000` → `030000` → `040000`. **Não** a `050000` ainda.
3. Rodar a foto **DEPOIS**. Diff tem que ser **0** — com `rbac_v2_enabled` ainda `false` em todos.
4. Publicar o frontend **junto com** a migration `050000`.
5. Só então: `update tenants set rbac_v2_enabled = true where nome in ('ASP','Digi Office Sistemas');`

Rollback em qualquer ponto: `rbac_v2_enabled = false`. As tabelas antigas continuam intactas e voltam a mandar.

⚠️ Nenhuma migration aqui mexe em `supabase/functions/**`, então **o push não dispara deploy de edge function**.
