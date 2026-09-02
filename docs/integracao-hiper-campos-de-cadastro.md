# PortalHiper — campos de cadastro que faltam para o DoctorSaaS

**Para quem mexe no PortalHiper.** Levantamento de 02/09/2026, medido contra as
994 contas do espelho em produção.

O DoctorSaaS quer comparar e atualizar seis campos do cadastro do cliente a
partir do portal. Hoje **só um deles existe** no payload da API.

## O que a API já entrega

`GET /api/integ/v1/clientes` (paginado por cursor, `limit` até 200) devolve por
conta:

`id_portal` · `cnpj` · `razao_social` · `nome_fantasia` · `cidade` · `uf` ·
`situacao` · `responsavel_tipo` · `plano` · `plano_detalhe{qt_usuarios,
qt_caixas, qt_filiais}` · `cliente_desde` · `cancelada_em` · `cancelada_por` ·
`saude` · `ultimo_acesso` · `mrr` · `a_pagar` · `bruto_mes` · `custo_mes` ·
`cadastro{mensalidade, custo, repasse, taxa_central}` ·
`ultimo_extrato{mes, mensalidade, custo, a_pagar, a_receber, lancamentos_12m}` ·
`modulos[]` · `filiais[]` · `qt_modulos` · `atraso_dias` · `total_aberto` ·
`usuarios_contratados` · `usuarios_ativos_30d` · `last_scraped_at`

## O que falta

Os dados **já existem na tela** do PortalHiper (bloco "Dados cadastrais",
confirmado em 02/09), mas o endpoint que o DoctorSaaS consome ainda não os
devolve: conferido no JSON cru das 994 contas, nenhuma traz qualquer um deles,
em nenhuma grafia.

### O que a tela mostra hoje

Exemplo real da conta 2 YOU STORE:

```
E-MAIL              2youstoreoficial@gmail.com
TELEFONE            (43) 9-9682-3785
DOMÍNIO             2youstore.hiper.com.br
INSCRIÇÃO ESTADUAL  9105230742
ENDEREÇO            AV THEODORO VICTORELLI, 150, HELENA, LONDRINA - PR, 86027-750
CONTATO RESPONSÁVEL Felipe Soares de Oliveira Gabriel / 2youstoreoficial@gmail.com / 43 996823785
ATENDIMENTO         Hiperador, Hotfix
```

### Mande separado, não como está na tela

**Este é o pedido que mais importa.** Três desses campos são concatenações
feitas para o olho humano, e desmontá-las depois é adivinhação:

- `AV THEODORO VICTORELLI, 150, HELENA, LONDRINA - PR, 86027-750` — a vírgula
  separa cinco coisas aqui, mas não em endereço sem número, e o hífen de
  `LONDRINA - PR` também aparece em `SÃO JOSÉ DO RIO PRETO`.
- `Felipe … / e-mail / 43 996823785` — a barra funciona até um contato ter duas
  barras ou nenhum telefone.
- `(43) 9-9682-3785` — o nono dígito sai separado por hífen, formato que nenhuma
  máscara comum reconhece.

Quem raspa a página tem os campos ainda separados, antes de virarem uma linha.
É lá que a separação é confiável.

### Contrato pedido

| Campo na API | Destino no DoctorSaaS | Formato |
|---|---|---|
| `email` | `clientes.email` | string minúscula, um único endereço |
| `telefone` | `clientes.telefone_whatsapp` | **só dígitos, com DDD**: `43996823785`. Nada de máscara |
| `cep` | `clientes.cep` + resolve cidade | só dígitos: `86027750` |
| `logradouro` | `clientes.endereco` | `AV THEODORO VICTORELLI` |
| `numero` | `clientes.numero` | `150` — é o único que o CEP não dá |
| `bairro` | `clientes.bairro` | `HELENA` |
| `contato_nome` | `clientes.contato_nome` | `Felipe Soares de Oliveira Gabriel` |
| `contato_email` | (usado só para conferir) | opcional |
| `contato_telefone` | `clientes.contato_fone` | só dígitos com DDD |
| `dominio` | `clientes.observacao_cliente` | sem protocolo: `2youstore.hiper.com.br` |

Nulo é aceito em todos: ausência é tratada como "o portal não sabe" e não
sobrescreve o que já existe aqui.

**Cidade e UF já vêm** nos campos `cidade`/`uf` que a API entrega hoje — e, com
o CEP, o DoctorSaaS resolve cidade e estado sozinho pelo ViaCEP, que já é usado
no cadastro e na importação. Basta o CEP; logradouro e bairro são conferência.

**Sem destino no DoctorSaaS:** `INSCRIÇÃO ESTADUAL` e `ATENDIMENTO` não têm
campo correspondente. Pode mandar, mas hoje não há onde gravar — só caberiam na
observação, junto do domínio.

## Uma exigência que vale para tudo

**Decodificar as entidades HTML antes de mandar.** O portal hoje entrega o que
leu da tela, marcação e tudo: das 33 contas com "&" na razão social, as 33
chegavam como `&amp;`. Isso contaminou 20 cadastros no DoctorSaaS — o nome
`AGOSTINI & PICHETTI LTDA` virou `AGOSTINI &amp; PICHETTI LTDA` — e fez a
comparação de nomes acusar divergência falsa, porque a normalização vira
`AGOSTINI AMP PICHETTI`.

Corrigido dos dois lados em 02/09: o DoctorSaaS passou a decodificar na entrada
(helper `txt` em `supabase/functions/hiper-integration-call`) e os 53 registros
afetados foram reescritos. **A correção do lado do portal continua valendo** —
decodificar na origem evita que o problema reapareça em qualquer campo novo,
e os campos desta lista (endereço, nome do contato) são justamente onde `&`,
`º` e aspas aparecem.

## Razão social: o portal NÃO deve ser a fonte

Levantamento das 10 divergências de nome em produção: em 7 delas o cadastro do
DoctorSaaS é o melhor dos dois, porque carrega o apelido comercial que a
operação usa (`LORIVALDO DA SILVA LTDA - Cia Fix Matriz` contra `LORIVALDO DA
SILVA LTDA`). O DoctorSaaS também busca a razão social na Receita a partir do
CNPJ, que é fonte mais confiável que a tela do portal.

Não é preciso mudar nada no portal por causa disso — é decisão do lado de cá
sobre o que fazer com o campo.
