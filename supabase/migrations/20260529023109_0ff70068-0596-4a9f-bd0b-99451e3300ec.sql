ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS user_code text,
  ADD COLUMN IF NOT EXISTS badge_code text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_user_code_key
  ON public.profiles (lower(user_code))
  WHERE user_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_badge_code_key
  ON public.profiles (badge_code)
  WHERE badge_code IS NOT NULL;