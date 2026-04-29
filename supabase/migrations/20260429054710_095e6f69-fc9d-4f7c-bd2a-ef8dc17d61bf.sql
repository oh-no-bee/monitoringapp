ALTER TABLE public.custom_triggers REPLICA IDENTITY FULL;
ALTER TABLE public.trigger_settings REPLICA IDENTITY FULL;
ALTER TABLE public.analyst_comments REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.custom_triggers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.trigger_settings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.analyst_comments;