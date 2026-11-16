// Settings > AI Assistants (MCP): how to connect Claude or ChatGPT to the Warehouse Wizard MCP server.
// Tool list mirrors src/lib/mcp/index.ts — keep MCP_TOOLS in sync when tools are added.
import { useState } from "react";
import { Check, Copy, ExternalLink, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";
export const MCP_SERVER_URL = `https://${projectRef}.supabase.co/functions/v1/mcp`;

const OAUTH_SCOPES = [
  { scope: "openid", why: "Confirms who you are when the assistant signs in." },
  { scope: "email", why: "Lets Wizard match the connection to your user account." },
  { scope: "profile", why: "Shows your name on the consent screen and in audit logs." },
];

const MCP_TOOLS = [
  { name: "list_warehouses", what: "Lists warehouses you can see (optionally hidden ones).", reads: "warehouses" },
  { name: "search_products", what: "Finds active products by SKU, barcode or name.", reads: "products" },
  { name: "inventory_summary", what: "On-hand, available and reserved quantities for a SKU per warehouse and location.", reads: "products, inventory balances, locations" },
];

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 text-xs">{value}</code>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label="Copy"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function ConnectorShortcut({ label, href }: { label: string; href: string }) {
  return (
    <Button asChild size="sm">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => void navigator.clipboard?.writeText(MCP_SERVER_URL)}
      >
        <ExternalLink className="mr-1.5 h-4 w-4" />{label}
      </a>
    </Button>
  );
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="list-decimal space-y-2 pl-5 text-sm">
      {items.map((s) => <li key={s}>{s}</li>)}
    </ol>
  );
}

const claudeCodeCmd = `claude mcp add --transport http warehouse-wizard ${MCP_SERVER_URL}`;

export function McpSettingsTab() {
  return (
    <>
      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Connect an AI assistant</CardTitle>
          <CardDescription>
            Warehouse Wizard exposes an MCP (Model Context Protocol) server so Claude or ChatGPT can look up
            warehouses, products and stock for you. The assistant signs in as you and only sees what your role can see.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm font-medium">Server URL</p>
          <CopyField value={MCP_SERVER_URL} />
          <div className="flex flex-wrap gap-2 pt-2">
            <ConnectorShortcut label="Add to Claude" href="https://claude.ai/settings/connectors" />
            <ConnectorShortcut label="Add to ChatGPT" href="https://chatgpt.com/#settings/Connectors" />
          </div>
          <p className="text-xs text-muted-foreground">Shortcuts copy the server URL, then open the assistant's connector settings — click "Add custom connector" and paste.</p>
          <p className="text-xs text-muted-foreground">Transport: Streamable HTTP · Auth: OAuth 2.1 (sign in with your Wizard account)</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Setup</CardTitle>
          <CardDescription>Pick your assistant.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="claude">
            <TabsList>
              <TabsTrigger value="claude">Claude</TabsTrigger>
              <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
              <TabsTrigger value="chatgpt">ChatGPT</TabsTrigger>
            </TabsList>
            <TabsContent value="claude" className="mt-4">
              <Steps items={[
                "Open claude.ai (or the Claude desktop app) → Settings → Connectors.",
                "Click \"Add custom connector\", name it Warehouse Wizard and paste the server URL.",
                "Click Connect. A Warehouse Wizard sign-in opens — sign in and click Approve.",
                "In a chat, enable the Warehouse Wizard connector from the tools menu.",
              ]} />
              <p className="mt-3 text-xs text-muted-foreground">Team/Enterprise plans: an owner may need to add the connector for the organization first.</p>
            </TabsContent>
            <TabsContent value="claude-code" className="mt-4 space-y-3">
              <Steps items={[
                "Run this in a terminal:",
              ]} />
              <CopyField value={claudeCodeCmd} />
              <Steps items={["Start claude, run /mcp, choose warehouse-wizard and authenticate in the browser."]} />
            </TabsContent>
            <TabsContent value="chatgpt" className="mt-4">
              <Steps items={[
                "Open ChatGPT → Settings → Apps & Connectors → Advanced, and turn on Developer mode (Plus/Pro/Business plans).",
                "Click Create (add connector), name it Warehouse Wizard and paste the server URL.",
                "Set Authentication to OAuth, accept the custom-connector warning and click Create.",
                "Sign in with your Wizard account and Approve; then enable the connector in a chat via the + menu.",
              ]} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Scopes & access</CardTitle>
          <CardDescription>What you approve on the consent screen.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2 text-sm">
            {OAUTH_SCOPES.map((s) => (
              <li key={s.scope} className="flex gap-2">
                <Badge variant="secondary" className="shrink-0 font-mono">{s.scope}</Badge>
                <span>{s.why}</span>
              </li>
            ))}
          </ul>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>All tools are <strong>read-only</strong>. Nothing can be created, changed or deleted.</p>
            <p>Data access follows your Wizard role and warehouse assignments (row-level security), exactly like the app.</p>
            <p>To revoke, remove the connector in your assistant. Changing your Wizard password also ends its sessions.</p>
          </div>
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Available tools</CardTitle>
          <CardDescription>Ask in plain language, e.g. "How many units of SKU ABC-123 are in each warehouse?"</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="divide-y rounded-md border">
            {MCP_TOOLS.map((t) => (
              <div key={t.name} className="grid gap-1 p-3 sm:grid-cols-[180px_1fr_auto] sm:items-center">
                <code className="text-xs font-semibold">{t.name}</code>
                <span className="text-sm">{t.what}</span>
                <span className="text-xs text-muted-foreground">Reads: {t.reads}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
