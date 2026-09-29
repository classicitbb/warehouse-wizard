
-- Add the correct 'developer' value to the role enum (kept alongside legacy 'dev').
ALTER TYPE public.app_role_code ADD VALUE IF NOT EXISTS 'developer';
