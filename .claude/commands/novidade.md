# /novidade

Grava prints e vídeo de uma entrega, monta a prévia, e, com o OK do Alexandre, publica
na **Evolução DS** de todos os clientes (botão "Ver como funciona" na aba).

Contexto do usuário, se ele escreveu algo depois do comando: **$ARGUMENTS**
(normalmente o código da demanda, `DEM-0000`. Sem código, pergunte qual é.)

---

## Por que este comando existe

Os clientes não liam as Releases do DoctorDev. A Evolução DS trouxe as releases para dentro
do sistema; este comando põe **vídeo e passo a passo com a tela real** nas novidades e
melhorias, sem ninguém gravar à mão. Quem grava é você, no fim da conversa da demanda,
porque é aqui que se sabe o que mudou e onde clicar.

**Correção só quando o Alexandre pedir.** O `/publicar` não oferece o `/novidade` para 🔧, mas se ele
chamar o `/novidade` numa correção, grave normalmente: a correção com mídia ganha o botão
"Ver como funciona" dentro do bloco de correções do dia. Mostre o antes e o depois do sintoma.

---

## 1. Preparar o ambiente (local, nada em produção)

```bash
docker ps -a --filter name=supabase           # stack local de pé? (ver memória "Tirar print")
./scripts/novidade/conferir-login.sh operador@local.dev
```

- O `conferir-login.sh` **tem que passar**. Ele barra super admin e usuário fora da empresa
  de teste. **Nunca contorne**: o banco local já teve cópia dos dados reais dos clientes, e o
  que sair daqui é mostrado a todos os outros.
- Se o operador de teste cair em **"Sem acesso"**, o catálogo de permissões do local está
  vazio: `select count(*) from resources` = 0. Copie `permission_modules` e `resources` da
  produção (só leitura, é catálogo, não dado de cliente).
- Suba o app contra o banco local (sem criar `.env.local`):

```bash
KEY=$(grep PUBLISHABLE .env.local.off | cut -d= -f2- | tr -d '"')
VITE_SUPABASE_URL="http://127.0.0.1:54321" VITE_SUPABASE_PUBLISHABLE_KEY="$KEY" \
  node node_modules/vite/bin/vite.js --port 8097 --host 127.0.0.1 --strictPort   # em background
```

## 2. Entender a entrega

- Leia a demanda no DoctorDev (`supabase db query --linked` numa pasta isolada ligada a
  `luucsmybijcaejhfiwwr`) e o que mudou no Git.
- A release da demanda **precisa existir** no DoctorDev (criada pelo "Incluir nas Releases?").
  Sem ela o `publicar.mjs` bloqueia.

## 3. Dado de exemplo na empresa de teste

Tela vazia não ensina nada. Antes de gravar, crie no banco **local**, no tenant
`d0000000-0000-0000-0000-00000000dead`, o mínimo que a tela precisa para fazer sentido:
clientes, contratos, conversas, tickets. **Tudo inventado** ("Padaria Exemplo Ltda",
"(11) 90000-0001", CNPJ de teste). Nunca copie dado de produção para isso.

## 4. Roteiro e texto

Escreva no scratchpad:

- `roteiro.json`: formato no topo de `scripts/novidade/gravar.mjs`. De 3 a 6 passos, cada um
  com uma legenda curta que diga **o que a pessoa faz e por quê**. O primeiro passo sem legenda
  pode só abrir a tela inicial. Prefira seletores estáveis: `a[href='/rota']`, `#id`,
  `button:has-text('...')`.
- `texto.json`: `tipo` (`nova_funcionalidade`, `melhoria` ou `correcao`), `titulo`, `resumo` (1 frase),
  `para_que_serve` (2 a 3 frases curtas, situações reais de uso), `modulo`, `demanda`.
  Linguagem de cliente, **sem travessão** (é texto de tela).

## 5. Gravar e conferir

```bash
node scripts/novidade/gravar.mjs <roteiro.json> <pasta>
node scripts/novidade/previa.mjs <pasta> <texto.json>
```

**Abra cada print** (Read) antes de mostrar. Refaça se aparecer: "Sem acesso", tela vazia,
aviso tampando, destaque no lugar errado, ou **qualquer nome, telefone ou CNPJ que não seja
inventado** (neste caso pare e investigue, não publique).

## 6. Prévia para o Alexandre

Publique `<pasta>/index.html` como Artifact, com `root` = `<pasta>` e `files` = os
`passo-N.png` e `{"video.webm": {"from": "video.webm", "contentType": "video/webm"}}`.
Mande o link e pergunte:

1. Publicar com vídeo e passo a passo
2. Publicar **só o passo a passo com os prints**, sem vídeo (`--sem-video`)
3. Publicar **em destaque** (topo da aba por 14 dias; só uma por vez)
4. Mudar algo antes (refaça só o pedaço pedido e mande o link de novo)

Destaque e sem vídeo podem ir juntos.

## 7. Publicar (só depois do OK)

```bash
node scripts/novidade/publicar.mjs <pasta> <texto.json> DEM-0000 --simular    # confere
node scripts/novidade/publicar.mjs <pasta> <texto.json> DEM-0000 [--destaque] [--sem-video]
```

Escreve em produção no DoctorDev: sobe os arquivos no bucket `novidades` e preenche a
release (`para_que_serve`, `passo_a_passo`, `video_url`, `destaque`). Release já publicada tem
**título e resumo travados** no DoctorDev (o cliente já leu): o script mantém os de hoje e só envia
a mídia. Não despublique para contornar.

Confira que chegou:

```bash
curl -s https://luucsmybijcaejhfiwwr.supabase.co/functions/v1/releases-feed | grep -c '"imagem_url":"http'   # releases com passo a passo
```

## 8. Fechar

Uma linha: publicada, com quantos passos, com ou sem vídeo, em destaque ou não.
Derrube os servidores que você subiu.
