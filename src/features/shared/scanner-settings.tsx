import { useState } from "react";
import { ScanLine, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_SCAN_COOLDOWN_MS,
  DEFAULT_SCAN_DWELL_MS,
  SCAN_COOLDOWN_MAX_MS,
  SCAN_COOLDOWN_MIN_MS,
  SCAN_DWELL_MAX_MS,
  SCAN_DWELL_MIN_MS,
  getScanCooldownMs,
  getScanDwellMs,
  setScanCooldownMs,
  setScanDwellMs,
} from "@/lib/scan-settings";

/**
 * Per-device scanner tuning so dwell and cooldown can be adjusted on the floor
 * without a rebuild.
 */
export function ScannerSettingsPanel() {
  const [dwell, setDwell] = useState(() => String(getScanDwellMs()));
  const [cooldown, setCooldown] = useState(() => String(getScanCooldownMs()));

  const save = () => {
    const nextDwell = setScanDwellMs(Number(dwell));
    const nextCooldown = setScanCooldownMs(Number(cooldown));
    setDwell(String(nextDwell));
    setCooldown(String(nextCooldown));
    toast.success(`Scanner updated — ${nextDwell} ms dwell, ${nextCooldown} ms cooldown on this device`);
  };

  const reset = () => {
    setDwell(String(setScanDwellMs(DEFAULT_SCAN_DWELL_MS)));
    setCooldown(String(setScanCooldownMs(DEFAULT_SCAN_COOLDOWN_MS)));
    toast.success("Scanner timings reset to defaults");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScanLine className="h-4 w-4" />
          Scanner timing
        </CardTitle>
        <CardDescription>
          Tune the camera scanner for this device. Dwell is how long a code must stay in view before it is accepted;
          cooldown ignores the same code for a moment after a successful scan so a double trigger cannot submit twice.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="scan-dwell-ms">Scan dwell (ms)</Label>
          <Input
            id="scan-dwell-ms"
            type="number"
            inputMode="numeric"
            min={SCAN_DWELL_MIN_MS}
            max={SCAN_DWELL_MAX_MS}
            step={50}
            value={dwell}
            onChange={(e) => setDwell(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            0 accepts a found code instantly. {SCAN_DWELL_MIN_MS}–{SCAN_DWELL_MAX_MS} ms.
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="scan-cooldown-ms">Duplicate-scan cooldown (ms)</Label>
          <Input
            id="scan-cooldown-ms"
            type="number"
            inputMode="numeric"
            min={SCAN_COOLDOWN_MIN_MS}
            max={SCAN_COOLDOWN_MAX_MS}
            step={100}
            value={cooldown}
            onChange={(e) => setCooldown(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            The same code is ignored for this long after it is accepted. {SCAN_COOLDOWN_MIN_MS}–{SCAN_COOLDOWN_MAX_MS} ms.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={save}>Save scanner timing</Button>
          <Button type="button" variant="outline" onClick={reset}>
            <RotateCcw data-icon="inline-start" />
            Reset to defaults
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
