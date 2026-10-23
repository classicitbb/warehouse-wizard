import { describe, expect, it } from "vitest";

// `_shared/netsuite-auth.ts` is a Deno module (it imports './netsuite.ts'), so
// this file is excluded from tsconfig.app.json like the live integration test.
import { buildClientAssertion, generateNetSuiteCertificate } from "../../supabase/functions/_shared/netsuite-auth";

describe("client assertion scopes", () => {
  async function claims(scopes?: Parameters<typeof buildClientAssertion>[2]) {
    const cert = await generateNetSuiteCertificate("test");
    const jwt = await buildClientAssertion(
      { accountId: "9738806-sb1", clientId: "client", certificateId: "cert", privateKeyPem: cert.privateKeyPem },
      undefined,
      scopes,
    );
    return JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  }

  it("asks for REST Web Services only unless told otherwise", async () => {
    expect((await claims()).scope).toEqual(["rest_webservices"]);
  });

  it("can ask for the restlets scope, which a RESTlet call needs", async () => {
    expect((await claims(["restlets"])).scope).toEqual(["restlets"]);
  });
});
