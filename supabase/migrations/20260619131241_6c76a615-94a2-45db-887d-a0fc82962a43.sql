ALTER TABLE public.support_tickets REPLICA IDENTITY FULL;
ALTER TABLE public.support_ticket_events REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_ticket_events;