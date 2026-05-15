CREATE OR REPLACE FUNCTION public.mark_mention_seen(p_mention_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.ticket_mentions
  SET seen_at = now()
  WHERE id = p_mention_id
    AND mentioned_user_id = auth.uid()
    AND seen_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_mentions_seen()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.ticket_mentions
  SET seen_at = now()
  WHERE mentioned_user_id = auth.uid()
    AND seen_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.mark_mention_seen(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_mentions_seen() TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_mentions;