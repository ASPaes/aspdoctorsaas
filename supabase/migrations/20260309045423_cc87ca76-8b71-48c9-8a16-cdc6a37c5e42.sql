ALTER TABLE public.whatsapp_sentiment_analysis 
  ADD COLUMN IF NOT EXISTS needs_cs_ticket boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cs_ticket_reason text,
  ADD COLUMN IF NOT EXISTS cs_ticket_created_id uuid REFERENCES public.cs_tickets(id);