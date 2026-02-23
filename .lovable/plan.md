
# Sincronizar Estados e Cidades via IBGE

## Resumo
Criar uma Edge Function que busca dados do IBGE e popula as tabelas `estados` e `cidades` via UPSERT, e adicionar um botao na tela de Cadastros para acionar essa sincronizacao.

## 1. Edge Function `populate-cidades`

**Arquivo:** `supabase/functions/populate-cidades/index.ts`

- Recebe requisicao POST
- Busca estados da API publica do IBGE: `https://servicodados.ibge.gov.br/api/v1/localidades/estados`
- Para cada estado, faz UPSERT na tabela `estados` usando `sigla` como chave unica (indice ja existe: `ux_estados_sigla`)
- Busca cidades: `https://servicodados.ibge.gov.br/api/v1/localidades/municipios`
- Faz UPSERT na tabela `cidades` usando `codigo_ibge` como chave unica (indice ja existe: `ux_cidades_codigo_ibge`)
- Usa `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (ja existem nos secrets) para autenticar no banco sem depender do token do usuario
- Retorna contagem de estados e cidades sincronizados
- CORS habilitado para chamadas do frontend
- Nenhuma chave sensivel exposta no frontend (a API do IBGE e publica, sem necessidade de chave)

**Configuracao:** Adicionar `[functions.populate-cidades]` com `verify_jwt = false` no `supabase/config.toml` (a funcao valida o token manualmente)

## 2. Frontend - Botao na tela Cadastros

**Arquivo:** `src/pages/Cadastros.tsx`

- Adicionar botao "Sincronizar Estados/Cidades" com icone de refresh
- Ao clicar, chama a Edge Function via `supabase.functions.invoke('populate-cidades')`
- Exibe estados de loading (spinner no botao), sucesso (toast verde com contagem) e erro (toast vermelho)
- Botao desabilitado durante o carregamento

## Detalhes Tecnicos

- A API do IBGE e publica e gratuita, sem necessidade de API key
- Os indices unicos `ux_estados_sigla` e `ux_cidades_codigo_ibge` ja existem no banco, garantindo que o UPSERT funcione sem duplicatas
- Nenhuma migracao de banco necessaria
- A Edge Function usa o service role key para bypassa RLS e fazer os inserts diretamente
