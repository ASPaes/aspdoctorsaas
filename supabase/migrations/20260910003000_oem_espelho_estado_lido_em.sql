-- ============================================================================
-- `estado_lido_em`: quando o DoctorSaaS leu a licença no parceiro, ao vivo
-- ============================================================================
-- Desde 09/09/2026 a `oem-licenca-estado` corrige o espelho com a leitura ao
-- vivo de cada clique (simulação, releitura e "sem mudança"). O buraco que isso
-- deixou aberto: a carga periódica (`oem-espelho-sync`, cron `17 */6`) grava
--
--   status: f.status, bloqueado: f.bloqueado === true, last_sync_oem: f.last_sync
--
-- **sem olhar idade nenhuma**. Ela copia a varredura do DoctorOEM por cima da
-- correção, e a varredura pode ser MAIS VELHA que a leitura: no 158 PIZZA &
-- BURGER (filial 22658) ela era de 13:27, de antes de a licença ser liberada no
-- portal às ~14:00. A correção das 20:27 seria desfeita sozinha na carga
-- seguinte, e o cliente voltaria a aparecer bloqueado sem que nada tivesse
-- acontecido.
--
-- `last_sync_oem` NÃO serve para isso e a tentação de reaproveitá-lo é o erro a
-- evitar: ele qualifica a linha inteira (custo, contadores e o jsonb de
-- módulos), e é dele que `v_oem_divergencia_modulo` tira a prova de frescor.
-- Carimbá-lo numa leitura que só olhou o estado faria dado de módulo parecer
-- mais novo do que é. São duas idades diferentes e agora são duas colunas.
--
-- A coluna é auto-limpante: assim que a varredura passar a ser mais nova que a
-- leitura, a comparação inverte e a carga volta a mandar sozinha. Não há nada
-- para expirar nem limpar.
-- ============================================================================

alter table public.oem_espelho_filial
  add column if not exists estado_lido_em timestamptz;

comment on column public.oem_espelho_filial.estado_lido_em is
  'Quando o DoctorSaaS leu o estado desta licença direto no parceiro (oem-licenca-estado). A carga do espelho não sobrescreve bloqueado/status/desativa_em quando esta data é mais nova que o last_sync da varredura. Diferente de last_sync_oem, que é a idade da linha inteira. Ver a migration 20260910003000.';
