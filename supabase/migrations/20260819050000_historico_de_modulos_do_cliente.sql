-- ============================================================================
-- Histórico de módulos do cliente: quem tirou, quem pôs, quando e quanto.
--
-- Não existia nada disso. `movimentos_mrr` registra o efeito no MRR, não a
-- mexida no módulo, e a sincronização do OEM agora mexe sozinha na lista —
-- sem registro, ninguém consegue responder "esse módulo saiu quando, e por
-- ordem de quem?".
--
-- O nome do módulo e o nome do usuário são GRAVADOS NO EVENTO, não buscados
-- por FK na hora de ler. Histórico que muda quando alguém renomeia um módulo,
-- ou que fica vazio quando o módulo é apagado do catálogo, não é histórico.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cliente_produto_modulo_eventos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  cliente_produto_id  uuid NOT NULL,
  modulo_id           uuid,
  modulo_nome         text NOT NULL,
  -- adicionado · cancelado · reativado · removido · quantidade
  acao                text NOT NULL,
  quantidade          numeric,
  vlr_custo           numeric,
  vlr_mensal          numeric,
  -- 'oem' = mexida da sincronização; 'manual' = alguém na tela.
  origem              text NOT NULL DEFAULT 'manual',
  usuario_id          uuid,
  usuario_nome        text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Sem FK para cliente_produtos de propósito: o histórico tem que sobreviver ao
-- produto ser removido da ficha — é justamente aí que ele é procurado.
CREATE INDEX IF NOT EXISTS idx_cpm_eventos_produto
  ON public.cliente_produto_modulo_eventos (cliente_produto_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cpm_eventos_tenant
  ON public.cliente_produto_modulo_eventos (tenant_id, created_at DESC);

ALTER TABLE public.cliente_produto_modulo_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cpm_eventos_select ON public.cliente_produto_modulo_eventos;
CREATE POLICY cpm_eventos_select ON public.cliente_produto_modulo_eventos
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR tenant_id = public.current_tenant_id());

-- Ninguém escreve à mão: quem grava é o gatilho, que roda como definer.
-- Histórico que a tela consegue editar não serve para nada.

-- ============================================================================
-- O gatilho. Mudança só de valor NÃO vira evento: a sincronização do OEM
-- atualiza custo a cada carga e o histórico viraria uma parede de reajustes,
-- escondendo justamente o que se procura (entrou/saiu).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_log_cliente_produto_modulo() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $trg$
DECLARE
  v_acao    text;
  v_row     public.cliente_produto_modulos;
  v_nome    text;
  v_uid     uuid := auth.uid();
  v_usuario text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_acao := 'adicionado'; v_row := NEW;
  ELSIF TG_OP = 'DELETE' THEN
    v_acao := 'removido';   v_row := OLD;
  ELSE
    IF NEW.ativo IS DISTINCT FROM OLD.ativo THEN
      v_acao := CASE WHEN NEW.ativo THEN 'reativado' ELSE 'cancelado' END;
      v_row := NEW;
    ELSIF NEW.quantidade IS DISTINCT FROM OLD.quantidade THEN
      v_acao := 'quantidade'; v_row := NEW;
    ELSE
      RETURN NULL;
    END IF;
  END IF;

  SELECT m.nome INTO v_nome FROM public.produto_modulos m WHERE m.id = v_row.modulo_id;

  -- profiles não tem nome: ele vem de funcionarios pelo funcionario_id.
  -- Sem usuário (cron, sincronização do OEM) fica nulo e a tela mostra a origem.
  IF v_uid IS NOT NULL THEN
    SELECT f.nome INTO v_usuario
      FROM public.profiles p
      LEFT JOIN public.funcionarios f ON f.id = p.funcionario_id
     WHERE p.user_id = v_uid
     LIMIT 1;
  END IF;

  INSERT INTO public.cliente_produto_modulo_eventos
    (tenant_id, cliente_produto_id, modulo_id, modulo_nome, acao, quantidade,
     vlr_custo, vlr_mensal, origem, usuario_id, usuario_nome)
  VALUES
    (v_row.tenant_id, v_row.cliente_produto_id, v_row.modulo_id,
     coalesce(v_nome, '(módulo sem cadastro)'), v_acao, v_row.quantidade,
     v_row.vlr_custo, v_row.vlr_mensal, coalesce(v_row.origem, 'manual'),
     v_uid, v_usuario);

  RETURN NULL;
END;
$trg$;

ALTER FUNCTION public.trg_log_cliente_produto_modulo() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_log_cliente_produto_modulo ON public.cliente_produto_modulos;
CREATE TRIGGER trg_log_cliente_produto_modulo
  AFTER INSERT OR UPDATE OR DELETE ON public.cliente_produto_modulos
  FOR EACH ROW EXECUTE FUNCTION public.trg_log_cliente_produto_modulo();

-- ============================================================================
-- Ponto de partida: um "adicionado" para cada módulo que já existe, com a data
-- REAL de criação da linha. Não é história inventada — é o carimbo que a
-- própria linha carrega. Usuário fica vazio porque ninguém sabe quem foi, e
-- fingir que sabe seria pior.
-- Só roda se a tabela estiver vazia, para reaplicar a migration não duplicar.
-- ============================================================================
INSERT INTO public.cliente_produto_modulo_eventos
  (tenant_id, cliente_produto_id, modulo_id, modulo_nome, acao, quantidade,
   vlr_custo, vlr_mensal, origem, created_at)
SELECT c.tenant_id, c.cliente_produto_id, c.modulo_id,
       coalesce(m.nome, '(módulo sem cadastro)'), 'adicionado', c.quantidade,
       c.vlr_custo, c.vlr_mensal, coalesce(c.origem, 'manual'), c.created_at
  FROM public.cliente_produto_modulos c
  LEFT JOIN public.produto_modulos m ON m.id = c.modulo_id
 WHERE NOT EXISTS (SELECT 1 FROM public.cliente_produto_modulo_eventos);

-- Módulo que já está inativo ganha também o evento de saída, na data em que
-- foi inativado. Sem isso a lista mostraria só a entrada de algo que não está
-- mais lá.
INSERT INTO public.cliente_produto_modulo_eventos
  (tenant_id, cliente_produto_id, modulo_id, modulo_nome, acao, quantidade,
   vlr_custo, vlr_mensal, origem, created_at)
SELECT c.tenant_id, c.cliente_produto_id, c.modulo_id,
       coalesce(m.nome, '(módulo sem cadastro)'), 'cancelado', c.quantidade,
       c.vlr_custo, c.vlr_mensal, coalesce(c.origem, 'manual'),
       coalesce(c.data_inativacao::timestamptz, c.updated_at)
  FROM public.cliente_produto_modulos c
  LEFT JOIN public.produto_modulos m ON m.id = c.modulo_id
 WHERE c.ativo = false
   AND NOT EXISTS (
     SELECT 1 FROM public.cliente_produto_modulo_eventos e
      WHERE e.cliente_produto_id = c.cliente_produto_id
        AND e.modulo_id = c.modulo_id
        AND e.acao = 'cancelado'
   );
