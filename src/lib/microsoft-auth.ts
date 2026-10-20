import { lovable } from "@/integrations/lovable/index";

/** OAuth returns to a public page before existing approval guards run. */
export async function signInWithMicrosoft(origin: string, next: string | null) {
  const callback = new URL("/login", origin);
  if (next?.startsWith("/") && !next.startsWith("//") && !next.includes("\\")) callback.searchParams.set("next", next);
  const result = await lovable.auth.signInWithOAuth("microsoft", { redirect_uri: callback.href });
  if (result.error) throw result.error;
  return result;
}