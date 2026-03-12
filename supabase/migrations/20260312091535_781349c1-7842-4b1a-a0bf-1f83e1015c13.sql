
-- Per-clip plugin configuration table
CREATE TABLE public.clip_plugin_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id uuid NOT NULL REFERENCES public.book_scenes(id) ON DELETE CASCADE,
  clip_id text NOT NULL,
  track_id text NOT NULL,
  user_id uuid NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scene_id, clip_id, user_id)
);

ALTER TABLE public.clip_plugin_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own clip plugin configs"
  ON public.clip_plugin_configs
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
