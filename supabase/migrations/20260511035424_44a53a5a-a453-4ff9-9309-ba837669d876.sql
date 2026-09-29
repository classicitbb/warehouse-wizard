DROP TRIGGER IF EXISTS prevent_self_approval_trg ON public.profiles;
CREATE TRIGGER prevent_self_approval_trg
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_self_approval();