
-- user_settings table for cloud-synced settings (useCloudSettings)
CREATE TABLE public.user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  setting_key text NOT NULL,
  setting_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, setting_key)
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own settings"
  ON public.user_settings FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- proxy_api_logs table for API router logging
CREATE TABLE public.proxy_api_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  model_id text NOT NULL,
  provider text NOT NULL DEFAULT 'proxyapi',
  request_type text NOT NULL DEFAULT 'test',
  status text NOT NULL DEFAULT 'success',
  latency_ms integer,
  tokens_input integer,
  tokens_output integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.proxy_api_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own logs"
  ON public.proxy_api_logs FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RPC to get API keys from profiles for edge functions
CREATE OR REPLACE FUNCTION public.get_my_api_keys()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(api_keys, '{}'::jsonb)
    FROM profiles
    WHERE id = auth.uid()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_api_keys() TO authenticated;
