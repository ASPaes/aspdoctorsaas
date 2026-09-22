-- Toque por tipo de aviso (som do chat por evento).
--
-- Guarda SÓ o que o usuário personalizou: `{"group":"grave"}`. Chave ausente
-- significa "toque padrão daquele evento", definido no frontend em
-- `src/lib/tones.ts` (DEFAULT_TONE). Gravar o id do padrão faria quem nunca
-- mexeu ficar preso no toque de hoje se o padrão mudar amanhã.
--
-- Eventos válidos hoje: queue, message, group, assignment, awaiting.
-- O id do toque não é validado no banco de propósito: o catálogo é do
-- frontend, que já ignora id desconhecido e cai no padrão.

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS sound_by_event jsonb;

ALTER TABLE public.user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_sound_by_event_obj;

ALTER TABLE public.user_preferences
  ADD CONSTRAINT user_preferences_sound_by_event_obj
  CHECK (sound_by_event IS NULL OR jsonb_typeof(sound_by_event) = 'object');

COMMENT ON COLUMN public.user_preferences.sound_by_event IS
  'Toque escolhido por tipo de aviso do chat. Só as personalizações; chave ausente = padrão do evento (src/lib/tones.ts). NULL = tudo no padrão.';
