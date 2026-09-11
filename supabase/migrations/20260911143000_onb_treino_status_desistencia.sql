-- Desfecho novo do sub-ticket de treino: o cliente desistiu daquele treinamento.
--
-- Por que NÃO é um "cancelado com rótulo": cancelado some do quadro e, quando era o
-- último treino vivo, devolve a jornada para o Onboarding (fn_onb_training_cancel_undo).
-- A desistência faz o contrário — o sub-ticket vai para a coluna de conclusão e a jornada
-- segue para o go-live. Comportamentos diferentes pedem status diferente.
--
-- ALTER TYPE ... ADD VALUE precisa estar COMMITADO antes de qualquer uso do novo rótulo,
-- por isso esta migration vem sozinha.
ALTER TYPE public.onb_treino_status ADD VALUE IF NOT EXISTS 'desistencia';
