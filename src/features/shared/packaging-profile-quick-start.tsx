// packaging-profile-quick-start.tsx — the top of the Create Packaging Profile
// dialog.
//
// Profiles are usually typed while a container is being stripped, from memory:
// a SKU and a spoken pack code ("twelve by seven"). Everything else on the
// form — profile name, package type, units per package — is derivable, so this
// strip fills them in as editable defaults rather than making someone answer
// three questions before the useful ones.

import { useEffect, useRef } from "react";
import type { UseFormReturn } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPackCodeAscii, parsePackCode } from "@/lib/measure";

export function PackagingProfileQuickStart({
  form,
}: {
  form: UseFormReturn<Record<string, unknown>>;
}) {
  const codeRef = useRef<HTMLInputElement>(null);
  const packagesPerLayer = form.watch("packages_per_layer");
  const layersPerPallet = form.watch("layers_per_pallet");

  // Auto-fill only while the field still holds a value this strip generated —
  // once someone types their own name, the pack code stops overwriting it.
  const generatedNameRef = useRef<string>("");

  useEffect(() => {
    const code = formatPackCodeAscii({
      packages_per_layer: packagesPerLayer as number | null,
      layers_per_pallet: layersPerPallet as number | null,
    });
    if (!code) return;
    const currentName = String(form.getValues("profile_name") ?? "").trim();
    if (currentName === "" || currentName === generatedNameRef.current) {
      generatedNameRef.current = code;
      form.setValue("profile_name", code, { shouldDirty: true });
    }
    if (!String(form.getValues("package_type") ?? "").trim()) {
      form.setValue("package_type", "case", { shouldDirty: true });
    }
    const units = Number(form.getValues("units_per_package"));
    if (!Number.isFinite(units) || units <= 0) {
      form.setValue("units_per_package", 1, { shouldDirty: true });
    }
  }, [packagesPerLayer, layersPerPallet, form]);

  function applyCode(raw: string) {
    const parsed = parsePackCode(raw);
    if (!parsed) return;
    form.setValue("packages_per_layer", parsed.packagesPerLayer, { shouldDirty: true });
    form.setValue("layers_per_pallet", parsed.layersPerPallet, { shouldDirty: true });
  }

  return (
    <div className="grid gap-1.5 rounded-lg border border-primary/40 bg-primary/5 p-4">
      <Label htmlFor="pack-code-quick-entry">Pack code</Label>
      <Input
        id="pack-code-quick-entry"
        ref={codeRef}
        inputMode="text"
        placeholder="12x7"
        className="max-w-[12rem] font-mono text-lg"
        onChange={(event) => applyCode(event.currentTarget.value)}
      />
      <p className="text-xs text-muted-foreground">
        Type the build the way the floor says it — 12x7, 8 by 6, 20*5. Cases per layer, then
        layers. The profile name, package type, and units per package fill in from it and can
        all be edited below.
      </p>
    </div>
  );
}
