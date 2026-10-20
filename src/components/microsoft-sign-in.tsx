import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { signInWithMicrosoft } from "@/lib/microsoft-auth";

export function MicrosoftSignIn() {
  const signIn = useMutation({
    mutationFn: () => signInWithMicrosoft(window.location.origin, new URLSearchParams(window.location.search).get("next")),
    onError: () => toast.error("Microsoft sign-in couldn’t finish. Please try again or use your email and password."),
  });
  return (
    <Button type="button" variant="outline" className="w-full" disabled={signIn.isPending} onClick={() => signIn.mutate()}>
      {signIn.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : (
        <svg aria-hidden="true" viewBox="0 0 20 20" className="mr-2 h-4 w-4 fill-current">
          <path d="M1 1h8v8H1zM11 1h8v8h-8zM1 11h8v8H1zM11 11h8v8h-8z" />
        </svg>
      )}
      Sign in with Microsoft
    </Button>
  );
}