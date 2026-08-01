-- Remove o shim de compatibilidade do go-live (20260802108000).
-- O frontend com a assinatura nova (p_produto_id bigint) foi publicado em
-- app.doctorsaas.com.br em 01/08 e verificado no bundle servido. Ninguém mais chama
-- a assinatura antiga.
DROP FUNCTION IF EXISTS public.fn_journey_go_live(uuid, timestamptz, uuid, uuid);
