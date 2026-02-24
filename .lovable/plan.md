

# Adicionar Secao de Endereco no Cadastro do Cliente

## Resumo

Criar uma secao "Endereco" dentro do card Dados Cadastrais, agrupando Estado e Cidade (ja existentes) com novos campos: CEP, Endereco, Numero e Bairro. O CEP tera mascara e consulta automatica via API publica ViaCEP.

---

## 1. Banco de Dados

Adicionar 4 colunas na tabela `clientes`:

```sql
ALTER TABLE clientes ADD COLUMN cep text;
ALTER TABLE clientes ADD COLUMN endereco text;
ALTER TABLE clientes ADD COLUMN numero text;
ALTER TABLE clientes ADD COLUMN bairro text;
```

---

## 2. Mascara de CEP

Adicionar funcao `maskCEP` em `src/lib/masks.ts`:
- Formato: `00000-000` (5 digitos, hifen, 3 digitos)

---

## 3. Consulta automatica via ViaCEP

Quando o usuario digitar os 8 digitos do CEP (formato completo `00000-000`), o sistema chamara a API publica `https://viacep.com.br/ws/{cep}/json/` e preenchera automaticamente:
- `endereco` (logradouro)
- `bairro`
- `estado_id` (buscando pela sigla UF retornada)
- `cidade_id` (buscando pelo nome da cidade retornada + estado)

Isso sera implementado diretamente no componente `DadosClienteTab.tsx` com um `useEffect` ou callback no `onChange` do CEP.

---

## 4. Frontend - DadosClienteTab.tsx

Reorganizar o layout para criar uma subsecao visual "Endereco" (com Separator e titulo, igual ao "Contato Principal"):

```text
[Campos cadastrais existentes: data_cadastro, razao_social, nome_fantasia, cnpj, email, telefones, area_atuacao, segmento, modelo_contrato, unidade_base, observacao]

--- Separator ---
Endereco
  CEP (com mascara e auto-fill) | Estado (Select - movido para ca)
  Cidade (Select - movido para ca) | Bairro
  Endereco (input) | Numero

--- Separator ---
Contato Principal
  [campos existentes]
```

Os campos Estado e Cidade serao removidos da grid superior e colocados na secao Endereco.

---

## 5. ClienteForm.tsx - Schema e Reset

- Adicionar ao schema Zod: `cep`, `endereco`, `numero`, `bairro` (todos `z.string().nullable()`)
- Adicionar nos `defaultValues`
- Adicionar no `form.reset()` ao carregar cliente existente

---

## Arquivos modificados

| Arquivo | Mudanca |
|---|---|
| Migration SQL | 4 novas colunas em clientes |
| `src/lib/masks.ts` | Adicionar `maskCEP` |
| `src/components/clientes/DadosClienteTab.tsx` | Criar secao Endereco, mover Estado/Cidade, adicionar CEP/Endereco/Numero/Bairro, logica ViaCEP |
| `src/pages/ClienteForm.tsx` | Adicionar campos no schema, defaultValues e reset |
| `src/integrations/supabase/types.ts` | Atualizado automaticamente |

