-- Fix: archive_system_log() / archive_system_logs_older_than() (added in
-- 20260717010000_system_logs_archiving.sql) select system_logs.resolved_by,
-- but the live system_logs table never actually got that column. The
-- consolidated schema migration (20260511000000) defines it via
-- `create table if not exists`, which was a no-op because system_logs
-- already existed from an earlier, pre-migration-history table, and the
-- migration that extended that legacy table (20260609195501) added
-- resolved/resolved_at/created_by but not resolved_by. Result:
--   column "resolved_by" does not exist ... (42703)
--
-- Add the missing column so the archive functions work as written.

ALTER TABLE public.system_logs
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;
