# DoctorOMIE — edge functions

Código das 21 edge functions do projeto Supabase **DoctorOMIE**
(`vqrytdntynxuqozehals`), que é **outro projeto**, separado do DoctorSaaS
(`vbngjzovjhkmietztffo`). É o serviço que fala com a API do Omie: escreve
contrato, cliente, vínculos, anexos e o espelho.

## Por que fica aqui e não em `supabase/functions/`

O workflow `deploy-edge-functions.yml` dispara em `supabase/functions/**` e
deploya no **DoctorSaaS**. Se estas funções morassem lá, seriam publicadas no
projeto errado. Esta pasta é deliberadamente invisível para o CI.

## Deploy — manual, sempre

```bash
supabase functions deploy <slug> --project-ref vqrytdntynxuqozehals
```

## ⚠️ Baixe antes de editar

Estas funções não tinham repositório até 03/08/2026. Foram deployadas à mão
durante meses, e não existe garantia de que o que está aqui continue igual ao
que está no ar — qualquer deploy manual feito fora daqui torna esta cópia
velha, sem aviso.

Já custou caro: em 03/08/2026 uma correção de troca de produto no
`ds-omie-contrato-alterar` subiu, funcionou, e foi **apagada horas depois** por
um deploy da mudança de reativação construído sobre uma cópia sem ela. Só
apareceu porque duas linhas da fila de sincronização voltaram a travar. Sem essa
coincidência, teria sumido em silêncio.

**Antes de editar qualquer arquivo daqui:**

```bash
supabase functions download <slug> --project-ref vqrytdntynxuqozehals
```

e mescle sobre o que voltou. Nunca edite a cópia do repo assumindo que ela está
em dia.

## Como este conteúdo foi obtido

Baixado da produção em 03/08/2026 via `supabase functions download`. O CLI
devolve o código **transpilado** — sem linhas em branco e sem vírgulas finais,
diferente do fonte original. Então um `diff` contra qualquer fonte anterior
acusa diferença de formatação mesmo quando o código é o mesmo; compare
comportamento, não texto.

O `ds-omie-contrato-alterar` aqui é a **v14**, que junta a reativação confiável
(`permitir_reativacao`) com a aplicação de troca de produto — as duas mudanças
de 03/08 que colidiram.

`investig-alterar-valor` e `investig-ler-venctextos` são funções de investigação
pontual, não fazem parte do fluxo.
