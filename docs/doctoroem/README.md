# Código do DoctorOEM que vive fora deste repo

O **DoctorOEM** (`furohpfhukwajhvnnbiw`) é outro projeto Supabase: é ele que
fala com a API do parceiro (PDV Legal / TabletCloud) e é dele que a
`oem-espelho-sync` daqui puxa o espelho.

As edge functions dele **não têm repositório**. Esta pasta guarda a cópia do
que foi alterado por aqui, para o código não existir só dentro da plataforma.

> ⚠️ **Nada aqui é deployado pelo CI deste repo**, e é de propósito: o workflow
> só olha `supabase/functions/**`, e uma cópia do DoctorOEM lá dentro seria
> publicada no projeto **errado**. Por isso o arquivo mora em `docs/` com o
> nome achatado (`<slug>.index.ts`).

## Como publicar uma alteração no DoctorOEM

O CLI escreve e lê a partir de `supabase/functions/<slug>/index.ts` relativo ao
diretório atual, então monte essa estrutura **fora deste repo** — rodar dentro
dele sobrescreve as functions do DoctorSaaS:

```bash
mkdir -p /tmp/oemfn/supabase/functions/oem-licenca-modulo
cp docs/doctoroem/oem-licenca-modulo.index.ts \
   /tmp/oemfn/supabase/functions/oem-licenca-modulo/index.ts
cd /tmp/oemfn
supabase functions deploy oem-licenca-modulo \
  --project-ref furohpfhukwajhvnnbiw --no-verify-jwt
```

`--no-verify-jwt` não é opcional: essas functions autenticam por `x-api-key`
(a chave que o DoctorSaaS guarda no Vault), não por JWT. Publicar sem a flag
liga a verificação de JWT e o DoctorSaaS passa a tomar 401.

Antes de editar, **baixe a de produção** e mescle sobre ela — a plataforma é a
fonte de verdade, não este arquivo:

```bash
cd /tmp/oemfn
supabase functions download oem-licenca-modulo --project-ref furohpfhukwajhvnnbiw
```

## O que está aqui

| Arquivo | O que é |
|---|---|
| `oem-licenca-modulo.index.ts` | Escreve na licença de uma filial: baixa/quantidade de módulo; desde 24/08/2026 o cadastro (nome da loja e CNPJ); desde 01/09/2026 o estado da licença (`novo_bloqueado` / `novo_desativado`). Ler‑modificar‑gravar, porque a rota do parceiro salva a filial inteira. |

As outras três (`oem-exportar`, `oem-diagnostico-filial`, `oem-sync-passo`)
continuam só na plataforma.
