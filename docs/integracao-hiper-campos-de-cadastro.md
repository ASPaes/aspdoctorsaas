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

Conferido no JSON cru das 994 contas: **nenhuma** traz qualquer um dos campos
abaixo, em nenhuma grafia (`telefone`, `fone`, `celular`, `whatsapp`, `email`,
`endereco`, `cep`, `logradouro`, `bairro`, `contato`, `responsavel`, `dominio`,
`site`, `url`).

| Campo pedido | Destino no DoctorSaaS | Formato esperado |
|---|---|---|
| `telefone` | `clientes.telefone_whatsapp` | string só com dígitos, com DDD: `47999991111`. Sem `+55`; se o portal tiver o país junto, mandar assim mesmo que o DoctorSaaS normaliza |
| `email` | `clientes.email` | string, minúscula, um único endereço |
| `cep` | resolve `clientes.cep`, `endereco`, `bairro`, `cidade_id` | string só com dígitos: `88350000`. **Só o CEP basta** — o DoctorSaaS já busca logradouro, bairro e cidade a partir dele |
| `endereco`, `numero`, `bairro` | `clientes.endereco`, `numero`, `bairro` | strings. Opcionais se o CEP vier; servem para o número, que o CEP não dá |
| `contato_nome` | `clientes.contato_nome` | string, nome da pessoa |
| `dominio` | `clientes.observacao_cliente` | string, domínio sem protocolo: `empresa.com.br` |

Nulo é aceito em todos: o DoctorSaaS trata ausência como "o portal não sabe" e
não sobrescreve o que já existe aqui.

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
