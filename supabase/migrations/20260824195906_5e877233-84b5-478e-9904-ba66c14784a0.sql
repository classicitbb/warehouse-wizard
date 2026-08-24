ALTER TABLE public.user_mobile_toolbar_preferences
  ADD COLUMN IF NOT EXISTS module_flags jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.user_mobile_toolbar_preferences
  DROP CONSTRAINT IF EXISTS user_mobile_toolbar_preferences_module_flags_is_object;

ALTER TABLE public.user_mobile_toolbar_preferences
  ADD CONSTRAINT user_mobile_toolbar_preferences_module_flags_is_object
  CHECK (jsonb_typeof(module_flags) = 'object');