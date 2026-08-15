-- 14/08/2026 - CORRECAO da migration 20260814140000 (mesmo dia, antes de qualquer uso real).
--
-- O QUE ESTAVA ERRADO: o guarda de no-op comparava o telefone NORMALIZADO por fn_fone_omie.
-- Como a normalizacao JA acrescenta o 9 do celular pre-2016, '(94) 9214-0639' e
-- '(94) 99214-0639' normalizam para o MESMO {94, 992140639}. Resultado: digitar no DS o 9 que
-- faltava -- que e exatamente a edicao que motivou tudo isto -- era lida como "nada mudou" e
-- NAO enfileirava. A funcao acertava em todos os casos que eu testei e falhava no unico que
-- importava.
--
-- CORRECAO: comparar os DIGITOS CRUS da origem, nao o normalizado.
--   - reformatar '(94) 99214-0639' -> '94 99214-0639': mesmos digitos -> continua sem enfileirar.
--   - acrescentar o 9: os digitos mudam -> enfileira -> o Omie recebe o numero certo.
-- O `fn_fone_omie` continua mandando no CONTEUDO enviado; ele so nao manda mais em decidir
-- se houve mudanca.
--
-- Segue valendo: telefone que nao vira numero legivel (v_fone_new IS NULL) nao enfileira.

CREATE OR REPLACE FUNCTION "public"."trg_cliente_cadastro_enfileirar_omie"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_contrato record;
  v_campos text[] := '{}';
  v_fone_new jsonb;
  v_dig_old  text;
  v_dig_new  text;
BEGIN
  -- Mesma fonte e mesma precedencia do montar_payload_contrato_omie.
  -- DIGITOS CRUS para DETECTAR mudanca; normalizado so para saber se ha o que enviar.
  v_dig_old := regexp_replace(
    COALESCE(NULLIF(btrim(OLD.telefone_whatsapp), ''), OLD.telefone_contato, ''), '\D', '', 'g');
  v_dig_new := regexp_replace(
    COALESCE(NULLIF(btrim(NEW.telefone_whatsapp), ''), NEW.telefone_contato, ''), '\D', '', 'g');
  v_fone_new := public.fn_fone_omie(
    COALESCE(NULLIF(btrim(NEW.telefone_whatsapp), ''), NEW.telefone_contato));

  -- O "AFTER UPDATE OF <cols>" dispara mesmo se a coluna foi citada sem mudar de valor.
  -- Esta checagem evita enfileirar no-op (e a chamada extra ao Omie que viria junto).
  IF (OLD.cnpj, OLD.razao_social, OLD.nome_fantasia, OLD.email, OLD.contato_nome,
      OLD.endereco, OLD.numero, OLD.bairro, OLD.complemento, OLD.cep, OLD.cidade_id)
     IS NOT DISTINCT FROM
     (NEW.cnpj, NEW.razao_social, NEW.nome_fantasia, NEW.email, NEW.contato_nome,
      NEW.endereco, NEW.numero, NEW.bairro, NEW.complemento, NEW.cep, NEW.cidade_id)
     -- digitos crus: reformatar nao e mudanca, mas acrescentar o 9 E.
     AND v_dig_old IS NOT DISTINCT FROM v_dig_new
  THEN
    RETURN NULL;
  END IF;

  -- Traduz cada coluna alterada para a CHAVE DO PAYLOAD que o upsert conhece.
  -- array_append (nao ||): ver cabecalho.
  IF NEW.cnpj          IS DISTINCT FROM OLD.cnpj          THEN v_campos := array_append(v_campos, 'cnpj_cpf'); END IF;
  IF NEW.razao_social  IS DISTINCT FROM OLD.razao_social  THEN v_campos := array_append(v_campos, 'razao_social'); END IF;
  IF NEW.nome_fantasia IS DISTINCT FROM OLD.nome_fantasia THEN v_campos := array_append(v_campos, 'nome_fantasia'); END IF;
  IF NEW.email         IS DISTINCT FROM OLD.email         THEN v_campos := array_append(v_campos, 'email'); END IF;
  IF NEW.contato_nome  IS DISTINCT FROM OLD.contato_nome  THEN v_campos := array_append(v_campos, 'contato'); END IF;
  IF NEW.endereco      IS DISTINCT FROM OLD.endereco      THEN v_campos := array_append(v_campos, 'endereco'); END IF;
  IF NEW.numero        IS DISTINCT FROM OLD.numero        THEN v_campos := array_append(v_campos, 'endereco_numero'); END IF;
  IF NEW.bairro        IS DISTINCT FROM OLD.bairro        THEN v_campos := array_append(v_campos, 'bairro'); END IF;
  IF NEW.complemento   IS DISTINCT FROM OLD.complemento   THEN v_campos := array_append(v_campos, 'complemento'); END IF;
  IF NEW.cep           IS DISTINCT FROM OLD.cep           THEN v_campos := array_append(v_campos, 'cep'); END IF;
  -- cidade_id vira DOIS campos no payload. ARRAY[...] e inequivoco: ja estava correto.
  IF NEW.cidade_id     IS DISTINCT FROM OLD.cidade_id     THEN v_campos := v_campos || ARRAY['cidade','estado']; END IF;
  -- telefone vira DOIS campos no payload. v_fone_new NULL (numero apagado ou ilegivel) nao
  -- enfileira: o upsert so manda valor nao-vazio e a linha morreria como 'ignorado'.
  IF v_dig_new IS DISTINCT FROM v_dig_old AND v_fone_new IS NOT NULL THEN
    v_campos := v_campos || ARRAY['telefone1_ddd','telefone1_numero'];
  END IF;

  IF array_length(v_campos, 1) IS NULL THEN RETURN NULL; END IF;

  FOR v_contrato IN
    SELECT c.id FROM contratos c
    WHERE c.cliente_id = NEW.id
      AND c.tenant_id  = NEW.tenant_id
      AND c.status     = 'ativo'
  LOOP
    PERFORM public.enfileirar_sync_omie(v_contrato.id, 'cadastro', v_campos);
  END LOOP;

  RETURN NULL;  -- AFTER trigger
END;
$$;

-- O gatilho e "AFTER UPDATE OF <colunas>": sem citar as colunas de telefone aqui, a funcao
-- acima nunca chega a rodar quando so o telefone muda.
CREATE OR REPLACE TRIGGER "cliente_cadastro_enfileirar_omie"
  AFTER UPDATE OF "cnpj", "razao_social", "nome_fantasia", "email", "contato_nome",
                  "endereco", "numero", "bairro", "complemento", "cep", "cidade_id",
                  "telefone_whatsapp", "telefone_contato"
  ON "public"."clientes"
  FOR EACH ROW EXECUTE FUNCTION "public"."trg_cliente_cadastro_enfileirar_omie"();
