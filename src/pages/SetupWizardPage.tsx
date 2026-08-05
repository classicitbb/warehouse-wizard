import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  createBlankLocationTemplate,
  createBlankWarehouse,
  createBlankZone,
  createDefaultWarehouseSetupPayload,
  loadExistingSetupPayload,
  runWarehouseSetup,
  type TemperatureClass,
  type WarehouseLocationTemplate,
  type WarehouseSetupPayload,
  type WarehouseSetupWarehouse,
  type WarehouseSetupZone,
} from "@/lib/wms-core";
import { setupWizardSteps } from "@/lib/help-content";
import { invalidateWarehouseData } from "@/lib/query-invalidation";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const steps = [
  "Warehouses",
  "Zones",
  "Location Rules",
  "Review",
  "Create",
] as const;

function temperatureOptions(): TemperatureClass[] {
  return ["ambient", "cool", "frozen"];
}

function StepIndicator({ step, current }: { step: number; current: number }) {
  const done = current > step;
  const active = current === step;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground shadow-xs"
          : done
            ? "border-emerald-600/40 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400"
            : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {done ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <Circle className={cn("h-3.5 w-3.5 shrink-0", active ? "fill-primary-foreground/30" : "")} />
      )}
      <span>{step + 1}. {steps[step]}</span>
    </div>
  );
}

export default function SetupWizardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { roles } = useAuth();
  const isDeveloper = roles.includes("developer");
  const [step, setStep] = useState(0);
  const [payload, setPayload] = useState<WarehouseSetupPayload>(createDefaultWarehouseSetupPayload());
  const [seedDemoData, setSeedDemoData] = useState(false);

  const existingQuery = useQuery({
    queryKey: ["setup-wizard", "existing"],
    queryFn: loadExistingSetupPayload,
    staleTime: 0,
  });

  const hasExisting = (existingQuery.data?.warehouses.length ?? 0) > 0;

  useEffect(() => {
    if (existingQuery.data && hasExisting) {
      setPayload(existingQuery.data);
    }
  }, [existingQuery.data, hasExisting]);

  const mutation = useMutation({
    mutationFn: async () => runWarehouseSetup(payload, seedDemoData ? "starter_ops" : "structure_only"),
    onSuccess: async () => {
      toast.success(seedDemoData ? "Warehouse structure created and demo data seeded." : "Warehouse structure created.");
      await invalidateWarehouseData(queryClient);
      navigate("/warehouses");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Setup failed"),
  });

  const totals = useMemo(
    () => ({
      warehouses: payload.warehouses.length,
      zones: payload.zones.length,
      locationTemplates: payload.locationTemplates.length,
      locationsWillCreate: payload.locationTemplates.reduce(
        (sum, t) => sum + t.aisleCount * t.baysPerAisle * t.levels * Math.max(1, t.positionsPerLevel || 1),
        0,
      ),
    }),
    [payload],
  );

  const updateWarehouse = (index: number, field: keyof WarehouseSetupWarehouse, value: string | boolean) => {
    setPayload((current) => ({
      ...current,
      warehouses: current.warehouses.map((warehouse, warehouseIndex) =>
        warehouseIndex === index ? { ...warehouse, [field]: value } : warehouse,
      ),
    }));
  };

  const updateZone = (index: number, field: keyof WarehouseSetupZone, value: string | boolean | number) => {
    setPayload((current) => ({
      ...current,
      zones: current.zones.map((zone, zoneIndex) => (zoneIndex === index ? { ...zone, [field]: value } : zone)),
    }));
  };

  const updateTemplate = (index: number, field: keyof WarehouseLocationTemplate, value: string | boolean | number) => {
    setPayload((current) => ({
      ...current,
      locationTemplates: current.locationTemplates.map((template, templateIndex) =>
        templateIndex === index ? { ...template, [field]: value } : template,
      ),
    }));
  };

  return (
    <div className="grid gap-6">
      <div
        className={cn(
          "rounded-lg border px-4 py-3 text-sm",
          hasExisting
            ? "border-amber-500/40 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200"
            : "border-primary/40 bg-primary/5 text-foreground",
        )}
      >
        {existingQuery.isLoading
          ? "Checking for existing warehouse configuration…"
          : hasExisting
            ? "An existing warehouse environment was detected. Existing warehouses, zones, and location rules are preloaded for review or extension. Add new entries below — nothing is created until you confirm in step 5."
            : "Starting from scratch — no warehouses exist yet. Add your first warehouse below. Forms are intentionally blank: type your own codes, names, and counts."}
      </div>

      {/* Step indicators with strong contrast */}
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((_, index) => (
          <StepIndicator key={steps[index]} step={index} current={step} />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Step Sequence</CardTitle>
          <CardDescription>Expand any step to see what it does before you run the wizard.</CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" className="w-full">
            {setupWizardSteps.map((s) => (
              <AccordionItem key={s.number} value={`wizard-step-${s.number}`}>
                <AccordionTrigger className="text-sm">
                  <span className="text-left">
                    <span className="font-medium">Step {s.number}: {s.title}</span>
                    <span className="ml-2 text-muted-foreground">{s.summary}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <ul className="grid gap-2 pl-4 text-sm text-muted-foreground">
                    {s.details.map((detail) => (
                      <li key={detail} className="list-disc">{detail}</li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Warehouse Setup Wizard</CardTitle>
          <CardDescription>
            Build the warehouse structure step by step. The wizard creates only the warehouses, zones, and locations you
            define here — no demo products, pallets, or orders are added.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {/* Step 0: Warehouses */}
          {step === 0 ? (
            <div className="grid gap-4">
              {payload.warehouses.map((warehouse, index) => (
                <Card
                  key={`${warehouse.code}-${index}`}
                  className={cn(index % 2 === 0 ? "bg-muted/30" : "bg-background")}
                >
                  <CardContent className="grid gap-4 p-4 md:grid-cols-2">
                    <Field label="Code">
                      <Input value={warehouse.code} onChange={(event) => updateWarehouse(index, "code", event.target.value.toUpperCase())} />
                    </Field>
                    <Field label="Name">
                      <Input value={warehouse.name} onChange={(event) => updateWarehouse(index, "name", event.target.value)} />
                    </Field>
                    <Field label="City">
                      <Input value={warehouse.city} onChange={(event) => updateWarehouse(index, "city", event.target.value)} />
                    </Field>
                    <Field label="Country">
                      <Input value={warehouse.country} onChange={(event) => updateWarehouse(index, "country", event.target.value)} />
                    </Field>
                    <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3 md:col-span-2">
                      <Label htmlFor={`warehouse-cool-${index}`}>Has cool zone</Label>
                      <Switch
                        id={`warehouse-cool-${index}`}
                        checked={warehouse.hasCoolZone}
                        onCheckedChange={(checked) => updateWarehouse(index, "hasCoolZone", checked)}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
              {payload.warehouses.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No warehouses yet. Click <strong>Add warehouse</strong> to start.
                </p>
              ) : null}
              <Button
                variant="outline"
                onClick={() =>
                  setPayload((current) => ({
                    ...current,
                    warehouses: [...current.warehouses, createBlankWarehouse()],
                  }))
                }
              >
                <Plus data-icon="inline-start" />
                Add warehouse
              </Button>
            </div>
          ) : null}

          {/* Step 1: Zones */}
          {step === 1 ? (
            <div className="grid gap-4">
              {payload.zones.map((zone, index) => (
                <Card
                  key={`${zone.warehouseCode}-${zone.code}-${index}`}
                  className={cn(index % 2 === 0 ? "bg-muted/30" : "bg-background")}
                >
                  <CardContent className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
                    <Field label="Warehouse">
                      <Select value={zone.warehouseCode} onValueChange={(value) => updateZone(index, "warehouseCode", value)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {payload.warehouses.filter((w) => w.code.trim() !== "").map((warehouse) => (
                            <SelectItem key={warehouse.code} value={warehouse.code}>{warehouse.code}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Code">
                      <Input value={zone.code} onChange={(event) => updateZone(index, "code", event.target.value.toUpperCase())} />
                    </Field>
                    <Field label="Name">
                      <Input value={zone.name} onChange={(event) => updateZone(index, "name", event.target.value)} />
                    </Field>
                    <Field label="Temperature">
                      <Select value={zone.temperatureClass} onValueChange={(value) => updateZone(index, "temperatureClass", value as TemperatureClass)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {temperatureOptions().map((temperature) => (
                            <SelectItem key={temperature} value={temperature}>{temperature}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Sort order">
                      <Input type="number" value={zone.sortOrder} onChange={(event) => updateZone(index, "sortOrder", Number(event.target.value))} />
                    </Field>
                    <div className="grid gap-3 rounded-lg border border-border p-4 xl:col-span-3">
                      <ToggleRow label="Staging zone" checked={zone.isStaging} onCheckedChange={(checked) => updateZone(index, "isStaging", checked)} />
                      <ToggleRow label="Dispatch zone" checked={zone.isDispatch} onCheckedChange={(checked) => updateZone(index, "isDispatch", checked)} />
                      <ToggleRow label="Quarantine zone" checked={zone.isQuarantine} onCheckedChange={(checked) => updateZone(index, "isQuarantine", checked)} />
                    </div>
                  </CardContent>
                </Card>
              ))}
              {payload.zones.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No zones yet. Click <strong>Add zone</strong> to start.
                </p>
              ) : null}
              <Button
                variant="outline"
                onClick={() =>
                  setPayload((current) => ({
                    ...current,
                    zones: [...current.zones, createBlankZone(current.warehouses[0]?.code ?? "")],
                  }))
                }
              >
                <Plus data-icon="inline-start" />
                Add zone
              </Button>
            </div>
          ) : null}

          {/* Step 2: Location Rules */}
          {step === 2 ? (
            <div className="grid gap-4">
              {payload.locationTemplates.map((template, index) => (
                <Card
                  key={`${template.warehouseCode}-${template.zoneCode}-${index}`}
                  className={cn(index % 2 === 0 ? "bg-muted/30" : "bg-background")}
                >
                  <CardContent className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
                    <Field label="Warehouse">
                      <Select value={template.warehouseCode} onValueChange={(value) => updateTemplate(index, "warehouseCode", value)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {payload.warehouses.filter((w) => w.code.trim() !== "").map((warehouse) => (
                            <SelectItem key={warehouse.code} value={warehouse.code}>{warehouse.code}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Zone">
                      <Select value={template.zoneCode} onValueChange={(value) => updateTemplate(index, "zoneCode", value)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {payload.zones
                            .filter((zone) => zone.warehouseCode === template.warehouseCode && zone.code.trim() !== "")
                            .map((zone) => (
                              <SelectItem key={`${zone.warehouseCode}-${zone.code}`} value={zone.code}>{zone.code}</SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Location type">
                      <Input value={template.locationType} onChange={(event) => updateTemplate(index, "locationType", event.target.value)} />
                    </Field>
                    <Field label="Temperature">
                      <Select value={template.temperatureClass} onValueChange={(value) => updateTemplate(index, "temperatureClass", value as TemperatureClass)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {temperatureOptions().map((temperature) => (
                            <SelectItem key={temperature} value={temperature}>{temperature}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Aisles">
                      <Input type="number" value={template.aisleCount} onChange={(event) => updateTemplate(index, "aisleCount", Number(event.target.value))} />
                    </Field>
                    <Field label="Bays per aisle">
                      <Input type="number" value={template.baysPerAisle} onChange={(event) => updateTemplate(index, "baysPerAisle", Number(event.target.value))} />
                    </Field>
                    <Field label="Levels">
                      <Input type="number" value={template.levels} onChange={(event) => updateTemplate(index, "levels", Number(event.target.value))} />
                    </Field>
                    <Field label="Positions / level (1–3)">
                      <Input type="number" min={1} max={3} value={template.positionsPerLevel} onChange={(event) => updateTemplate(index, "positionsPerLevel", Number(event.target.value))} />
                    </Field>
                    <Field label="Depth = capacity (1–5)">
                      <Input type="number" min={1} max={5} value={template.depth} onChange={(event) => updateTemplate(index, "depth", Number(event.target.value))} />
                    </Field>
                    <Field label="Status">
                      <Input value={template.status} onChange={(event) => updateTemplate(index, "status", event.target.value)} />
                    </Field>
                    <div className="grid gap-3 rounded-lg border border-border p-4 xl:col-span-3">
                      <ToggleRow label="Allow mixed SKU" checked={template.mixedSkuAllowed} onCheckedChange={(checked) => updateTemplate(index, "mixedSkuAllowed", checked)} />
                      <ToggleRow label="Allow mixed lot" checked={template.mixedLotAllowed} onCheckedChange={(checked) => updateTemplate(index, "mixedLotAllowed", checked)} />
                    </div>
                    <Button
                      variant="ghost"
                      className="justify-start xl:col-span-3"
                      onClick={() =>
                        setPayload((current) => ({
                          ...current,
                          locationTemplates: current.locationTemplates.filter((_, templateIndex) => templateIndex !== index),
                        }))
                      }
                    >
                      <Trash2 data-icon="inline-start" />
                      Remove template
                    </Button>
                  </CardContent>
                </Card>
              ))}
              {payload.locationTemplates.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No location rules yet. Click <strong>Add location template</strong> to start.
                </p>
              ) : null}
              <Button
                variant="outline"
                onClick={() =>
                  setPayload((current) => ({
                    ...current,
                    locationTemplates: [
                      ...current.locationTemplates,
                      createBlankLocationTemplate(
                        current.warehouses[0]?.code ?? "",
                        current.zones[0]?.code ?? "",
                      ),
                    ],
                  }))
                }
              >
                <Plus data-icon="inline-start" />
                Add location template
              </Button>
            </div>
          ) : null}

          {/* Step 3: Review — summary cards + worksheet matrix */}
          {step === 3 ? (
            <div className="grid gap-6">
              <div className="grid gap-4 lg:grid-cols-4">
                <SummaryCard title="Warehouses" value={totals.warehouses} description="Facilities to create or update." />
                <SummaryCard title="Zones" value={totals.zones} description="Operational and storage areas." />
                <SummaryCard title="Location Rules" value={totals.locationTemplates} description="Generation templates." />
                <SummaryCard title="Locations" value={totals.locationsWillCreate} description="Physical locations that will be generated." />
              </div>

              {/* Warehouse → Zone mapping */}
              <Card>
                <CardHeader>
                  <CardTitle>Warehouse matrix</CardTitle>
                  <CardDescription>Confirm warehouse codes match across warehouses, zones, and location rules before creating.</CardDescription>
                </CardHeader>
                <CardContent className="overflow-auto p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Warehouse</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>City</TableHead>
                        <TableHead>Cool zone</TableHead>
                        <TableHead>Zones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payload.warehouses.map((wh, i) => (
                        <TableRow key={wh.code} className={cn(i % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                          <TableCell className="font-mono font-semibold">{wh.code}</TableCell>
                          <TableCell>{wh.name}</TableCell>
                          <TableCell>{wh.city}, {wh.country}</TableCell>
                          <TableCell>{wh.hasCoolZone ? "Yes" : "—"}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {payload.zones.filter((z) => z.warehouseCode === wh.code).map((z) => z.code).join(", ") || "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Location template matrix */}
              <Card>
                <CardHeader>
                  <CardTitle>Location generation matrix</CardTitle>
                  <CardDescription>Each row generates aisles × bays × levels × positions locations inside the named zone. Capacity per slot = depth.</CardDescription>
                </CardHeader>
                <CardContent className="overflow-auto p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>WH</TableHead>
                        <TableHead>Zone</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Temp</TableHead>
                        <TableHead className="text-right">Aisles</TableHead>
                        <TableHead className="text-right">Bays</TableHead>
                        <TableHead className="text-right">Levels</TableHead>
                        <TableHead className="text-right">Pos/lvl</TableHead>
                        <TableHead className="text-right">Depth</TableHead>
                        <TableHead className="text-right">Total locs</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payload.locationTemplates.map((t, i) => {
                        const locs = t.aisleCount * t.baysPerAisle * t.levels * Math.max(1, t.positionsPerLevel || 1);
                        return (
                          <TableRow key={i} className={cn(i % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                            <TableCell className="font-mono">{t.warehouseCode}</TableCell>
                            <TableCell className="font-mono">{t.zoneCode}</TableCell>
                            <TableCell>{t.locationType}</TableCell>
                            <TableCell>{t.temperatureClass}</TableCell>
                            <TableCell className="text-right">{t.aisleCount}</TableCell>
                            <TableCell className="text-right">{t.baysPerAisle}</TableCell>
                            <TableCell className="text-right">{t.levels}</TableCell>
                            <TableCell className="text-right">{t.positionsPerLevel}</TableCell>
                            <TableCell className="text-right">{t.depth}</TableCell>
                            <TableCell className="text-right font-semibold">{locs}</TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="border-t-2 bg-muted/30 font-semibold">
                        <TableCell colSpan={9} className="text-right text-muted-foreground">Total locations</TableCell>
                        <TableCell className="text-right">{totals.locationsWillCreate}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          ) : null}

          {/* Step 4: Create */}
          {step === 4 ? (
            <div className="grid gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Create and Seed</CardTitle>
                  <CardDescription>
                    This will create the warehouse structure you defined above. No demo products, pallets, or orders
                    are added unless you opt in below.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <p className="text-sm text-muted-foreground">
                    The wizard is idempotent — existing warehouse codes are updated in place. Run{" "}
                    <strong>Reset All</strong> in Settings first if you want a completely clean slate.
                  </p>
                  {isDeveloper ? (
                    <div className="flex items-center justify-between rounded-lg border border-dashed border-border px-4 py-3">
                      <div className="grid gap-1">
                        <Label htmlFor="seed-demo">Also load demo operational data (developers only)</Label>
                        <span className="text-xs text-muted-foreground">
                          Adds sample clients, products, pallets, receipts, putaway/pick/transfer work, and cycle counts.
                        </span>
                      </div>
                      <Switch id="seed-demo" checked={seedDemoData} onCheckedChange={setSeedDemoData} />
                    </div>
                  ) : null}
                  <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                    {mutation.isPending ? <Loader2 className="animate-spin" /> : null}
                    {seedDemoData ? "Create warehouse structure and seed demo data" : "Create warehouse structure"}
                  </Button>
                </CardContent>
              </Card>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" onClick={() => setStep((current) => Math.max(current - 1, 0))} disabled={step === 0 || mutation.isPending}>
              Back
            </Button>
            <Button onClick={() => setStep((current) => Math.min(current + 1, steps.length - 1))} disabled={step === steps.length - 1 || mutation.isPending}>
              Next
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label>{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function SummaryCard({ title, value, description }: { title: string; value: number; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
