
CREATE TABLE public.scene_renders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scene_id UUID NOT NULL REFERENCES public.book_scenes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  voice_path TEXT,
  atmo_path TEXT,
  sfx_path TEXT,
  voice_duration_ms INTEGER NOT NULL DEFAULT 0,
  atmo_duration_ms INTEGER NOT NULL DEFAULT 0,
  sfx_duration_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  render_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(scene_id)
);

ALTER TABLE public.scene_renders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own scene renders"
  ON public.scene_renders
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
