import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type State = "idle" | "working" | "done" | "error";

/**
 * Public landing page for emailed unsubscribe links. Nothing is written until
 * the person clicks the button, so mail scanners that prefetch links cannot
 * unsubscribe anyone by accident.
 */
export default function UnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get("t")?.trim() ?? "";
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");

  async function confirm() {
    setState("working");
    const { data, error } = await supabase.functions.invoke("email-unsubscribe", { body: { token } });
    if (error || !data?.ok) {
      setState("error");
      setMessage(data?.error ?? "We could not complete the unsubscribe. Please try again.");
      return;
    }
    setState("done");
    setMessage(`${data.email} will no longer receive Warehouse Wizard notification emails.`);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Warehouse Wizard emails</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {!token ? (
            <p>This unsubscribe link is incomplete. Please use the link exactly as it appears in the email.</p>
          ) : state === "done" ? (
            <p>{message} In-app and push notifications are unaffected — you can change those in Settings.</p>
          ) : (
            <>
              <p>Stop receiving Warehouse Wizard notification emails at this address?</p>
              {state === "error" && <p className="text-destructive">{message}</p>}
              <Button onClick={confirm} disabled={state === "working"} className="w-full">
                {state === "working" ? "Unsubscribing…" : "Unsubscribe"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
