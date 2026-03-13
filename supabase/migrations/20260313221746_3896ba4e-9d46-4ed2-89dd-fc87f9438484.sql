
-- Drop the broken cron job and recreate with correct function reference
SELECT cron.unschedule('check-csat-timeout');

SELECT cron.schedule(
  'check-csat-timeout',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vbngjzovjhkmietztffo.supabase.co/functions/v1/check-csat-timeout',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZibmdqem92amhrbWlldHp0ZmZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MDM1MTUsImV4cCI6MjA4NzM3OTUxNX0.A9O36VZMT3x0OlnvjyEUwfa7TwLXkATTqw1dhMpJmGQ"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
