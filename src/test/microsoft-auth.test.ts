import { beforeEach, describe, expect, it, vi } from "vitest";
const oauth = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/lovable/index", () => ({ lovable: { auth: { signInWithOAuth: oauth } } }));
import { signInWithMicrosoft } from "@/lib/microsoft-auth";

describe("Microsoft sign-in", () => {
  beforeEach(() => { oauth.mockReset(); oauth.mockResolvedValue({ redirected: true }); });
  it("uses Microsoft and a public same-origin callback with the intended destination", async () => {
    await signInWithMicrosoft("https://warehousewizard.app", "/pick-lists/123");
    expect(oauth).toHaveBeenCalledWith("microsoft", { redirect_uri: "https://warehousewizard.app/login?next=%2Fpick-lists%2F123" });
  });
  it.each(["https://other.example", "//other.example", "/\\other.example"])("rejects an unsafe destination: %s", async (next) => {
    await signInWithMicrosoft("https://warehousewizard.app", next);
    expect(oauth).toHaveBeenCalledWith("microsoft", { redirect_uri: "https://warehousewizard.app/login" });
  });
  it("propagates provider failures so the operator can retry", async () => {
    oauth.mockResolvedValue({ error: new Error("Cancelled") });
    await expect(signInWithMicrosoft("https://warehousewizard.app", null)).rejects.toThrow("Cancelled");
  });
});