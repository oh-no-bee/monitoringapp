
CREATE TABLE IF NOT EXISTS public.watchlist_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_name text NOT NULL,
  trigger_key text NOT NULL,
  note text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (client_name, trigger_key)
);
ALTER TABLE public.watchlist_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public all" ON public.watchlist_assignments FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.watchlist_assignments;

ALTER TABLE public.trigger_settings ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;
