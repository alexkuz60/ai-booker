-- Enable realtime for segment_audio table to track per-clip synthesis progress
ALTER PUBLICATION supabase_realtime ADD TABLE public.segment_audio;