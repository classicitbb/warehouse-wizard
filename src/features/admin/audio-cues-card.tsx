// Settings > Notifications: test every floor sound cue.
import { AlertCircle, AlertTriangle, CheckCircle2, Play, QrCode, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { playBarcodeBeep, playConfirmTone, playAttentionTone, playNoGoTone } from "@/lib/floor-feedback";

const AUDIO_TEST_CUES: Array<{
  id: string;
  label: string;
  description: string;
  icon: typeof Volume2;
  play: () => void;
}> = [
  {
    id: "barcode-beep",
    label: "Scan beep",
    description: "Short confirmation chirp on every successful barcode scan.",
    icon: QrCode,
    play: playBarcodeBeep,
  },
  {
    id: "confirm-tone",
    label: "Confirm",
    description: "Task confirmed or completed — put-away, picking, moves, transfers, cycle counts.",
    icon: CheckCircle2,
    play: playConfirmTone,
  },
  {
    id: "attention-tone",
    label: "Attention",
    description: "Needs attention — short pick, cancellation, or rule violation. Flashes the screen and vibrates.",
    icon: AlertTriangle,
    play: playAttentionTone,
  },
  {
    id: "no-go-tone",
    label: "No-go",
    description: "Blocking failure that stops the task — scan mismatch, confirm failed. Loudest, rapid-fire.",
    icon: AlertCircle,
    play: playNoGoTone,
  },
];

export function AudioCuesCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Volume2 className="h-4 w-4" />
          Audio & Alerts
        </CardTitle>
        <CardDescription>Every sound cue used across the app, in one place — play each one to test speaker volume and confirm alerts are audible on the warehouse floor.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {AUDIO_TEST_CUES.map((cue) => (
          <div key={cue.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium text-foreground"><cue.icon className="h-3.5 w-3.5 shrink-0" />{cue.label}</p>
              <p className="text-xs text-muted-foreground">{cue.description}</p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={cue.play}>
              <Play data-icon="inline-start" />
              Play
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
