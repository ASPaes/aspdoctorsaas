# Evolução DS — como nasce o vídeo e o passo a passo de uma novidade

Este documento explica o que acontece por trás do botão **"Ver como funciona"** da aba
**Evolução DS**: como o vídeo e os prints são feitos, com quais ferramentas, e o caminho
até aparecerem para todos os clientes.

Resumo em uma frase: **ninguém grava a tela à mão.** O Claude escreve um roteiro, um
navegador automático executa o roteiro no DoctorSaaS **local** (nunca em produção), filma e
fotografa cada passo, e só depois do seu OK os arquivos sobem para o DoctorDev.

---

## O caminho completo

```
 Demanda entregue
       │
       ▼
 /publicar ──► registra no AtualizacoesDS.md
       │       e pergunta: "Subir para a Evolução DS com vídeo e passo a passo?"
       ▼ (sim)
 /novidade DEM-0000
       │
       ├─ 1. Prepara o ambiente local ........ Docker + banco local + app local
       ├─ 2. Confere o usuário de teste ...... conferir-login.sh (trava de segurança)
       ├─ 3. Cria dado de exemplo ............ "Padaria Exemplo Ltda", tudo inventado
       ├─ 4. Escreve roteiro e texto ......... roteiro.json + texto.json
       ├─ 5. Grava ........................... gravar.mjs  → prints + vídeo
       ├─ 6. Monta a prévia .................. previa.mjs  → página para você aprovar
       │
       ▼  ⏸  PARA AQUI e espera o seu OK
       │
       └─ 7. Publica ......................... publicar.mjs → DoctorDev (produção)
                                                     │
                                                     ▼
                       Evolução DS de todos os clientes mostra "Ver como funciona"
```

Tudo antes do passo 7 roda na sua máquina e não toca produção.

---

## As ferramentas

| O quê | Para quê | Onde fica |
|---|---|---|
| **Docker + Supabase local** | Banco de testes onde a gravação acontece | `./scripts/setup-local-db.sh` |
| **Vite (app local)** | O DoctorSaaS rodando na porta `8097`, apontando para o banco local | sobe pelo próprio `/novidade` |
| **Google Chrome** | O navegador que é filmado. Roda "invisível" (headless), sem abrir janela | o Chrome já instalado no Mac |
| **Playwright** | Biblioteca que pilota o Chrome: entra, clica, digita, arrasta, tira print e grava vídeo | instalada em `~/.ds-novidade`, **fora do repo** para não mexer nos lockfiles |
| **ffmpeg** | Corta o começo do vídeo (a tela de login) e comprime | vem junto com o Playwright |
| **Artifact do Claude** | Hospeda a prévia privada para você aprovar | link `claude.ai` que só você vê |
| **Supabase CLI** | Fornece a chave de serviço do DoctorDev na hora de publicar. A chave **nunca** fica em arquivo | `supabase login` |
| **DoctorDev** (`luucsmybijcaejhfiwwr`) | Onde a novidade mora: bucket `novidades` (arquivos) + tabela `releases` (texto e links) | produção |

Os scripts ficam em [scripts/novidade/](../scripts/novidade/) e o roteiro do Claude em
[.claude/commands/novidade.md](../.claude/commands/novidade.md).

---

## Passo a passo, com o porquê

### 1. Ambiente local

O app sobe contra o banco do Docker, não contra produção. O script de gravação **se recusa a
rodar** se o endereço não for `127.0.0.1` ou `localhost`.

### 2. A trava do usuário de teste — a parte mais importante

O banco local tem **cópia dos dados reais dos clientes** (conversas, telefones, CNPJs). E o
que é gravado aqui vai ser mostrado **para todos os clientes**. Um print com o nome de um
cliente seu na Evolução DS de outro cliente seria vazamento.

Por isso o `conferir-login.sh` só libera um usuário que:

1. é da **empresa de teste** (tenant `…00000000dead`, criada pelo `seed-local-fixtures.sh`);
2. **não é super admin** (super admin escolhe "Todos" e enxergaria todo mundo).

Com isso, quem garante que a tela só mostra dado inventado é o próprio RLS do banco, não a
atenção de alguém. O usuário padrão é `operador@local.dev`. **Essa trava nunca é contornada.**

### 3. Dado de exemplo

Tela vazia não ensina nada. Antes de gravar, o Claude cria na empresa de teste o mínimo
para a tela fazer sentido: clientes, contratos, conversas, tickets. Sempre inventado
("Padaria Exemplo Ltda", "(11) 90000-0001"). Nada é copiado de produção.

### 4. Roteiro e texto

São dois arquivos pequenos que o Claude escreve a partir do que mudou no código e da demanda
no DoctorDev.

**`roteiro.json`** — o que o navegador vai fazer, de 3 a 6 passos:

```json
{
  "login": { "email": "operador@local.dev", "senha": "..." },
  "abertura": { "titulo": "Custo do WhatsApp Oficial", "subtitulo": "Painel de Uso" },
  "passos": [
    { "ir": "/dashboard" },
    { "clicar": "a[href='/painel-uso']", "legenda": "Abra o Painel de Uso", "destacar": "h1" },
    { "clicar": "button:has-text('Custo WhatsApp Oficial')", "legenda": "Veja quanto a empresa gasta no mês" }
  ]
}
```

Cada passo pode **ir** para uma tela, **clicar**, **digitar**, **arrastar**, apertar uma
**tecla** ou **destacar** um pedaço da tela. Passo com legenda vira um print numerado.

**`texto.json`** — o que o cliente lê: tipo (novidade / melhoria / correção), título,
resumo de uma frase, "para que serve" em 2 ou 3 frases, módulo e código da demanda.
Linguagem de cliente, sem travessão.

### 5. Gravação (`gravar.mjs`)

O navegador automático faz login, e por cima do DoctorSaaS desenha uma **camada visual
própria** — não é recurso do sistema, só existe durante a gravação:

- **Abertura**: tela escura com o gradiente verde/azul da marca e o título da novidade.
- **Cursor animado** que desliza até o botão, com uma **onda verde** no clique.
- **Caixa de destaque** verde em volta do que importa, escurecendo o resto da tela.
- **Legenda numerada** no rodapé, explicando cada passo.
- Opcional: uma **aba de navegador desenhada** no topo, para quando a novidade é o nome da aba.

A cada passo com legenda ele tira um print **sem a legenda** (o texto aparece ao lado do print
na Evolução DS) e **com o destaque**. No fim, o ffmpeg corta o login do começo do vídeo.

Resultado na pasta: `passo-1.png`, `passo-2.png`, …, `video.webm` e `resultado.json`.

Quando a tela depende de algo que não roda no local (IA, envio de WhatsApp), o roteiro pode
**simular** a resposta daquela função. Só para a tela abrir; o conteúdo mostrado continua
vindo do banco local.

### 6. Conferência e prévia (`previa.mjs`)

Antes de te mostrar, o Claude **abre cada print** e refaz se aparecer: "Sem acesso", tela
vazia, aviso tampando, destaque no lugar errado — ou qualquer nome, telefone ou CNPJ que não
seja inventado (nesse caso ele para e investiga).

Depois monta uma página com o vídeo, o "para que serve" e o passo a passo, e publica como
**Artifact privado**. Você recebe o link e escolhe:

1. Publicar com vídeo e passo a passo
2. Publicar só o passo a passo, sem vídeo
3. Publicar **em destaque** (carrossel no topo da aba, 7 dias por padrão, ou o prazo que você disser)
4. Mudar algo antes

### 7. Publicação (`publicar.mjs`) — só depois do seu OK

Primeiro roda em modo **simulação**, que mostra o que faria sem gravar nada. Depois, de verdade:

1. Confere que a demanda **tem release no DoctorDev** (criada pelo "Incluir nas Releases?").
   Sem release, o script bloqueia.
2. Sobe prints e vídeo para o bucket `novidades`, numa pasta com data e hora — assim uma
   regravação nunca mostra a versão velha por cache do navegador.
3. Preenche a release: `para_que_serve`, `passo_a_passo` (legenda + link do print), `video_url`.
4. Se for destaque, marca no DoctorDev e grava o prazo em `evolucao_destaques`, no DoctorSaaS.

**Release já publicada tem título e resumo travados** (o cliente já leu aquele texto). Nesse
caso o script mantém o texto que está no ar e só acrescenta a mídia.

Para ligar ou desligar o destaque sem regravar nada: `destacar.mjs DEM-0000 [--dias N] [--remover]`.

---

## Como chega na tela do cliente

O DoctorSaaS não guarda a novidade. A aba Evolução DS lê o feed público do DoctorDev
(função `releases-feed`) em [src/hooks/useEvolucaoDS.ts](../src/hooks/useEvolucaoDS.ts).
Quando a release tem `video_url` ou `passo_a_passo`, aparece o botão **"Ver como funciona"**;
quando tem `destaque`, ela entra no carrossel do topo
([DestaqueCarrossel.tsx](../src/components/evolucao/DestaqueCarrossel.tsx)) até o prazo vencer.

Ou seja: publicou pelo script, aparece para todos os clientes, **sem deploy do frontend**.

---

## O que pode dar errado

| Sintoma | Causa | Solução |
|---|---|---|
| `conferir-login.sh` diz BLOQUEADO | Usuário errado, super admin, ou banco local parado | Rodar `./scripts/seed-local-fixtures.sh`; nunca trocar de usuário para contornar |
| Operador de teste cai em "Sem acesso" | Catálogo de permissões do local vazio | Copiar `permission_modules` e `resources` de produção (catálogo, não dado de cliente) |
| Vídeo começa na tela de login | ffmpeg não encontrado | Corrigido no Mac em 01/10/2026; antes só achava o do Windows |
| Seed ou trava escrevem no banco errado | Outro projeto Supabase rodando no mesmo Docker | Corrigido em 01/10/2026: os scripts agora pegam o banco pelo `project_id` do DoctorSaaS |
| `publicar.mjs` bloqueia | Demanda sem release no DoctorDev | Responder "Incluir nas Releases?" na demanda primeiro |
