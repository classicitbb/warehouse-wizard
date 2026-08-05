import { lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from "@/lib/router-compat";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, Eye, EyeOff, HelpCircle, Keyboard, Loader2, LogOut, Mail, RefreshCw, ScanLine, Sparkles, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { QRCodeSVG } from "qrcode.react";

import { useAuth } from "@/hooks/use-auth";
import { FeatureFlagContext, useFeatureFlagState } from "@/hooks/use-feature-flags";
import { enqueueOfflineWork, isLikelyNetworkError } from "@/lib/offline-queue";
import { supabase } from "@/integrations/supabase/client";

import { buildBayOccupancyGrid, confirmPickTask, formatDate, formatNumber, formatPickRackInstruction, getBayOccupancy, getInventoryDetail, getPickExecution, loginSchema, normalizeRackLocationCode, PickQuantityAnomalyError, recordUserSignIn, refreshUserDeviceTrust, signUpSchema, RESOURCE_DEFINITIONS } from "@/lib/wms-core";
import { beginActiveWork } from "@/lib/active-work";
import { getOrCreateDeviceId, hasTrustedDeviceShortcut, isDesktopClient } from "@/lib/device-identity";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BarcodeScanButton } from "@/components/barcode-scan-button";
import { HelpSidebar } from "@/components/help-sidebar";
import { HintButton } from "@/components/hint-button";

/** Full-page loading spinner shown while lazy chunks are fetched. */
export function PageSpinner() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading…" />
    </div>
  );
}

export const DashboardPage = lazy(() => import("@/components/wms-ui").then((mod) => ({ default: mod.DashboardPage })));
export const AppShell = lazy(() => import("@/components/wms-ui").then((mod) => ({ default: mod.AppShell })));
export const InventorySearchPage = lazy(() => import("@/components/wms-ui").then((mod) => ({ default: mod.InventorySearchPage })));
export const PickListsPage = lazy(() => import("@/components/wms-ui").then((mod) => ({ default: mod.PickListsPage })));
export const PutawayTasksPage = lazy(() => import("@/components/wms-ui").then((mod) => ({ default: mod.PutawayTasksPage })));
export const ReceivingPage = lazy(() => import("@/components/wms-ui").then((mod) => ({ default: mod.ReceivingPage })));
export const ReportsPage = lazy(() => import("@/components/wms-ui").then((mod) => ({ default: mod.ReportsPage })));
export const ResourcePage = lazy(() => import("@/components/wms-ui").then((mod) => ({ default: mod.ResourcePage })));
export const SettingsPage = lazy(() => import("@/components/wms-ui").then((mod) => ({ default: mod.SettingsPage })));
export const StatusPage = lazy(() => import("@/components/wms-ui").then((mod) => ({ default: mod.StatusPage })));
export const SystemLogPage = lazy(() => import("@/components/wms-ui").then((mod) => ({ default: mod.SystemLogPage })));
export const EmailLogPage = lazy(() => import("@/components/wms-ui").then((mod) => ({ default: mod.EmailLogPage })));
export const TransfersPage = lazy(() => import("@/components/wms-ui").then((mod) => ({ default: mod.TransfersPage })));
export const UsersRolesPage = lazy(() => import("@/components/wms-ui").then((mod) => ({ default: mod.UsersRolesPage })));
export const CycleCountsPage = lazy(() => import("@/components/wms-ui").then((mod) => ({ default: mod.CycleCountsPage })));
export const LocationMovesPage = lazy(() => import("@/components/wms-ui").then((mod) => ({ default: mod.LocationMovesPage })));
export const PalletLabelPage = lazy(() => import("@/components/pallet-label-page").then((mod) => ({ default: mod.PalletLabelPage })));
export const HelpCenterPage = lazy(() => import("@/pages/HelpCenter"));
export const SetupWizardPage = lazy(() => import("@/pages/SetupWizardPage"));
export const ProtectedShell = lazy(() =>
  import("@/components/wms-ui").then((mod) => ({
    default: function ProtectedShellComponent({ children }: { children: ReactNode }) {
      return (
        <mod.AppShell>
          {children}
          <mod.MobileActionBar />
        </mod.AppShell>
      );
    },
  })),
);

const RELEASE_HISTORY = [
  {
    version: "1.23",
    date: "June 2026",
    changes: [
      "Location Labels: printed and previewed location labels now show only the local rack-bay-level code, while warehouse, zone, aisle, bay, level, type, and temperature remain available as label context",
      "Bin Locations: single-position rack labels omit the unnecessary P1 suffix; P1/P2 remains available only when a bay-level has multiple side-by-side positions",
      "Settings: creation workflows were QA checked in external Chrome with direct typed input rather than clipboard-based browser filling",
    ],
  },
  {
    version: "1.22",
    date: "June 2026",
    changes: [
      "Receiving: New Shipment now follows a scanner-first vertical entry flow from container, to PO, to product, quantities, expiry, and optional lot details",
      "Receiving: container camera scanning can read printed container text, validate ISO 6346 check digits, show a green confirmed candidate, and insert it into the form",
      "Receiving: product scans select the SKU, then focus a highlighted right-arrow commit button before moving to Total received",
      "Receiving: quantity fields preserve manual typing, support Enter-to-advance, and can suggest learned quantity-per-pallet values after prior receipts",
      "Receiving: expiry selection now uses a larger app calendar picker for clearer mobile date entry",
      "Build: switched Vite from the SWC React plugin to @vitejs/plugin-react after the scanner update",
    ],
  },
  {
    version: "1.21",
    date: "June 2026",
    changes: [
      "Pick Execution: whole-pallet picks are enforced so operators confirm the assigned pallet quantity instead of entering partial quantities",
      "Pick Execution: rack instructions now use short four-part location codes with the warehouse context removed from the scanned/displayed location string",
      "Pick Lists: scanner-first create mode lets operators add product lines by scanning products repeatedly before editing quantities, client, order, and release details",
      "Pick Execution: the confirm button flashes yellow after the pallet scan and locks the scan fields until the operator confirms or the backend returns an error",
      "Help Center: added operator what-to-do guidance and a documented gap list for dead ends that still need live exception resolution",
    ],
  },
  {
    version: "1.2.0",
    date: "June 2026",
    changes: [
      "Location Moves: Browse bays button next to the location scanner opens the bay selector (with a warehouse picker when more than one facility is active)",
      "Location Moves: scanned pallet barcodes and location codes are trimmed/normalised before lookup so valid pallets are no longer reported as missing",
      "Warehouse Structure tool: dedicated Settings tab and Help topic explaining the live tree view of warehouses, zones, aisles, bays, and locations",
      "Help Center: per-module topics refreshed to cover browse-bay flows, label sheets, badge sign-in, access controls, and the Warehouse Structure tool",
      "Promoted from 1.1.8 beta: shortened bay codes open the bay selector in Put-Away and Pick; Bin Locations column order; Avery 99x38 location label sheets; Avery 99x93 bay/zone aisle sheets; trusted-device badge PIN limited to mobile/tablet; public Request Access removed in favour of admin-managed accounts",
    ],
  },
  {
    version: "1.1.7",
    date: "May 2026",
    changes: [
      "Labels: pallet/location/zone/warehouse codes print as QR for faster, more reliable scans",
      "Inventory Search: horizontal and vertical scrolling restored so every column is reachable",
      "Products: total on-hand quantity shown beside each product name (read-only)",
      "Navigation: desktop sidebar only mounts in landscape; portrait/tablets use the top slide-in nav. Help is always the last item",
      "Sidebar: squishy press feedback on nav buttons and tighter responsive width before the scrollbar kicks in",
      "Bin Locations: Edit Location now saves notes and max-height correctly (field-name mismatch fixed)",
      "Bin Locations & Zones: bulk label sheets — filter the table, then Print labels sheet (paper size, grid presets, start cell)",
      "Access requests: admins, supervisors, and managers see a full-screen prompt when pending users are awaiting approval, with a one-click jump to Users & Roles",
    ],
  },
  {
    version: "1.1.3",
    date: "May 2026",
    changes: [
      "Command Center: all Floor, Dock, and Office tiles are draggable and resizable",
      "Command Center: summary metrics and workflow tiles now share one dynamic layout surface per view",
      "Command Center: tile size and position preferences are remembered per signed-in user when available",
      "Navigation: Users shortcut removed from the sidebar while admin user management remains in Settings",
      "Dashboard: pallet dials, workflow queues, Warehouse Intelligence, Dock lanes, Office widgets, and Warehouse Brain use the same tile controls",
    ],
  },
  {
    version: "1.1.2",
    date: "May 2026",
    changes: [
      "Inventory Search: fixed header and filter shell with row-only result scrolling",
      "Inventory Search: warehouse scope matching now includes live warehouse, zone, aisle, and location codes",
      "Locations: generated and migrated codes now preserve warehouse, zone, and location hierarchy",
      "Location Labels: full hierarchy codes with QR output for complex location codes",
      "Put-Away: clearer location confirmation fields and aligned desktop task confirmation",
      "Tables: editable and detail rows now require double-click or double-tap before opening",
    ],
  },
  {
    version: "1.1.1",
    date: "May 2026",
    changes: [
      "Inventory Search: barcode-aware searching and warehouse scope filtering",
      "Put-Away: pallet confirmation, draft return prompts, and saved draft guidance",
      "Pick Lists: searchable pick list contents with scan support",
      "Inventory Detail: pallet barcode and full-page pallet label preview",
      "Mobile: configurable bottom toolbar and responsive table scrolling",
    ],
  },
  {
    version: "1.1.0",
    date: "May 2026",
    changes: [
      "Inline row editing with double-click and table action buttons",
      "Sticky table headers and horizontal overflow scrolling",
      "Back buttons on Inventory Detail and Pick Execution pages",
      "Settings About tab with version history and feature register",
    ],
  },
  {
    version: "1.0.0",
    date: "May 2026",
    changes: [
      "Warehouse, zone, location, client, product, and packaging master data",
      "Receiving, directed putaway, inventory search, pick lists, and transfers",
      "Dashboard, reporting, role-based access, barcode labels, and audit trail",
    ],
  },
];

function playBarcodeBeep() {
  try {
    const ctx = new (window.AudioContext ?? (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(1480, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.06);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.18);
    osc.onended = () => ctx.close();
  } catch {
    // Silent fallback when Web Audio is unavailable.
  }
}

function flashInput(el: HTMLElement | null, colour: "orange" | "blue" | "red" | "green" | "yellow") {
  if (!el) return;
  const palette: Record<string, string[]> = {
    orange: ["ring-2", "ring-orange-400", "ring-offset-1"],
    blue: ["ring-2", "ring-blue-400", "ring-offset-1"],
    red: ["ring-2", "ring-red-500", "ring-offset-1", "animate-pulse"],
    green: ["ring-2", "ring-green-500", "ring-offset-1"],
    yellow: ["ring-2", "ring-yellow-300", "ring-offset-1", "animate-pulse"],
  };
  const cls = palette[colour];
  el.classList.add(...cls);
  setTimeout(() => el.classList.remove(...cls), colour === "red" ? 1400 : 700);
}

function normalizeScannerText(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function isBaySelectorCode(value: string) {
  const normalized = normalizeScannerText(value);
  if (normalized.startsWith("BAY:")) return true;
  const parts = normalized.split("-").filter(Boolean);
  if (parts.length === 2 && /^\d+$/.test(parts[1])) return true;
  return parts.length >= 4 && !parts.some((part) => /^L\d+$/i.test(part));
}

function describePickLocation(location: { code?: string | null; aisle?: string | number | null; bay?: string | number | null; level?: string | number | null; position?: string | number | null } | null | undefined) {
  const code = normalizeRackLocationCode(String(location?.code ?? ""));
  if (!code) {
    return {
      fullCode: "assigned location",
      goTo: "assigned location",
    };
  }

  return {
    fullCode: code,
    goTo: formatPickRackInstruction({ ...location, code }),
  };
}

function playPickSuccessTone() {
  try {
    const ctx = new (window.AudioContext ?? (window as any).webkitAudioContext)();
    const now = ctx.currentTime;
    const make = (freq: number, start: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0.18, now + start);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + 0.18);
      osc.start(now + start);
      osc.stop(now + start + 0.2);
    };
    make(1320, 0);
    make(1980, 0.12);
    setTimeout(() => ctx.close(), 500);
  } catch {
    // ignore
  }
}

function PalletBarcodePreview({ code }: { code?: string | null }) {
  if (!code) return null;
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-white p-3">
      <QRCodeSVG value={code} size={160} bgColor="#ffffff" fgColor="#000000" level="H" />
      <p className="font-mono text-xs font-semibold tracking-wider text-black">{code}</p>
    </div>
  );
}

function friendlyAuthError(error: unknown, context: "login" | "signup" | "code" | "oauth"): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const msg = raw.toLowerCase();
  if (!raw) {
    return context === "signup" ? "Sign up failed. Please try again." : "Sign in failed. Please try again.";
  }
  if (msg.includes("pending admin approval")) return raw;
  if (msg.includes("invalid login") || msg.includes("invalid_credentials") || msg.includes("invalid credentials")) {
    return "The email or password you entered is incorrect. Please try again.";
  }
  if (msg.includes("no active approved user") || msg.includes("matched that code")) {
    return "We couldn't find an approved user matching that code or badge.";
  }
  if (msg.includes("email not confirmed") || msg.includes("not confirmed")) {
    return "Please verify your email address before signing in.";
  }
  if (msg.includes("user already registered") || msg.includes("already registered") || msg.includes("already exists")) {
    return "An account with this email already exists. Try signing in instead.";
  }
  if (msg.includes("weak password") || msg.includes("password should be") || msg.includes("password is too")) {
    return "Please choose a stronger password (at least 8 characters with letters and numbers).";
  }
  if (msg.includes("pwned") || msg.includes("compromised")) {
    return "This password has been found in a data breach. Please choose a different one.";
  }
  if (msg.includes("rate limit") || msg.includes("too many")) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (msg.includes("network") || msg.includes("failed to fetch")) {
    return "Network error — check your connection and try again.";
  }
  if (msg.includes("database error") || msg.includes("unexpected_failure") || msg.includes("schema")) {
    return "Sign-in is temporarily unavailable. Please try again in a moment.";
  }
  if (msg.includes("invalid email")) return "Please enter a valid email address.";
  if (msg.includes("refresh token")) return "Your session expired. Please sign in again.";
  if (msg.includes("popup") || msg.includes("cancelled") || msg.includes("canceled")) {
    return "Sign-in was cancelled. Please try again.";
  }
  return raw;
}

const LOGIN_BARCODE_FORMATS = [
  "qr_code", "code_128", "code_39", "code_93",
  "ean_13", "ean_8", "upc_a", "upc_e",
  "data_matrix", "pdf417", "aztec",
];
const LOGIN_METHOD_STORAGE_KEY = "warehouse-wizard.login.last-method";
const REMEMBER_ME_STORAGE_KEY = "warehouse-wizard-remember-me";

function LoginBadgeScanner({
  onScan,
  onErrorChange,
  scannedCode,
}: {
  onScan: (value: string) => void;
  onErrorChange: (error: string | null) => void;
  scannedCode?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectorRef = useRef<any>(null);

  const stopStream = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    detectorRef.current = null;
    setScanning(false);
  }, []);

  const startScanner = useCallback(async () => {
    stopStream();
    setError(null);
    onErrorChange(null);

    if (!("BarcodeDetector" in window)) {
      const nextError = "Live scanning requires Chrome on Android or Safari 17+.";
      setError(nextError);
      onErrorChange(nextError);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      setScanning(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      let formats = LOGIN_BARCODE_FORMATS;
      try {
        const supported: string[] = await (window as any).BarcodeDetector.getSupportedFormats();
        formats = LOGIN_BARCODE_FORMATS.filter((format) => supported.includes(format));
      } catch {
        // Older implementations do not expose getSupportedFormats.
      }

      detectorRef.current = new (window as any).BarcodeDetector({ formats: formats.length ? formats : LOGIN_BARCODE_FORMATS });

      const scanFrame = async () => {
        if (!videoRef.current || !detectorRef.current) return;
        try {
          const codes: Array<{ rawValue: string }> = await detectorRef.current.detect(videoRef.current);
          const value = codes[0]?.rawValue?.trim();
          if (value) {
            playBarcodeBeep();
            stopStream();
            onScan(value);
            return;
          }
        } catch {
          // Keep scanning until a frame can be read.
        }
        rafRef.current = requestAnimationFrame(scanFrame);
      };

      rafRef.current = requestAnimationFrame(scanFrame);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const nextError = msg.toLowerCase().includes("permission")
        ? "Camera permission denied. Allow camera access and try again."
        : `Camera error: ${msg}`;
      setError(nextError);
      onErrorChange(nextError);
      stopStream();
    }
  }, [onErrorChange, onScan, stopStream]);

  useEffect(() => {
    startScanner();
    return stopStream;
  }, [startScanner, stopStream]);

  return (
    <div className="space-y-2">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted autoPlay />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-28 w-52">
            <div className="absolute inset-0 rounded shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
            <div className="absolute left-0 top-0 h-6 w-6 rounded-tl border-l-2 border-t-2 border-white" />
            <div className="absolute right-0 top-0 h-6 w-6 rounded-tr border-r-2 border-t-2 border-white" />
            <div className="absolute bottom-0 left-0 h-6 w-6 rounded-bl border-b-2 border-l-2 border-white" />
            <div className="absolute bottom-0 right-0 h-6 w-6 rounded-br border-b-2 border-r-2 border-white" />
          </div>
        </div>
        <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-background/85 px-2 py-1 text-xs font-medium text-foreground">
          {scanning ? <ScanLine className="h-3.5 w-3.5" /> : <Camera className="h-3.5 w-3.5" />}
          {scanning ? "Scanning" : error ? "Scanner unavailable" : "Camera ready"}
        </div>
        {scannedCode ? (
          <div className="absolute inset-x-4 bottom-4 rounded-md bg-background/90 px-3 py-2 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Scanned badge</p>
            <p className="break-all font-mono text-sm font-semibold text-foreground">{scannedCode}</p>
          </div>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="absolute bottom-3 right-3 bg-background/90"
          onClick={startScanner}
        >
          <Camera className="mr-2 h-4 w-4" />
          Restart
        </Button>
      </div>
      {error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function PinKeypadDialog({
  open,
  pin,
  pending,
  onOpenChange,
  onPinChange,
  onSubmit,
}: {
  open: boolean;
  pin: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onPinChange: (pin: string) => void;
  onSubmit: () => void;
}) {
  const appendDigit = (digit: string) => {
    if (pin.length >= 12) return;
    onPinChange(`${pin}${digit}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Enter PIN</DialogTitle>
          <DialogDescription>Use the on-screen keypad to unlock the app.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="rounded-lg border border-border bg-secondary/40 px-3 py-4 text-center font-mono text-2xl tracking-[0.4em]">
            {pin ? "•".repeat(pin.length) : "----"}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
              <Button key={digit} type="button" variant="outline" className="h-14 text-xl" onClick={() => appendDigit(digit)}>
                {digit}
              </Button>
            ))}
            <Button type="button" variant="outline" className="h-14" onClick={() => onPinChange(pin.slice(0, -1))}>
              Clear
            </Button>
            <Button type="button" variant="outline" className="h-14 text-xl" onClick={() => appendDigit("0")}>
              0
            </Button>
            <Button type="button" variant="outline" className="h-14" onClick={() => onPinChange("")}>
              Reset
            </Button>
          </div>
          <Button type="button" className="h-12" disabled={pending || pin.length < 4} onClick={onSubmit}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Unlock app
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type InventoryDetailData = {
  balance: {
    status: string;
    quantity: number;
    available_quantity: number;
    reserved_quantity?: number;
    held_quantity?: number;
    damaged_quantity?: number;
    received_at?: string | null;
  };
  pallet: {
    pallet_code: string | null;
    pallet_barcode: string | null;
    length?: number | null;
    width?: number | null;
    height?: number | null;
    weight?: number | null;
  } | null;
  product?: {
    sku?: string | null;
    name?: string | null;
    barcode?: string | null;
    temperature_requirement?: string | null;
  } | null;
  client?: { code?: string | null; name?: string | null } | null;
  warehouse?: { code?: string | null; name?: string | null } | null;
  location?: { code?: string | null; aisle?: string | null; bay?: string | null; level?: string | null } | null;
  receipt?: {
    receipt_number?: string | null;
    receipt_type?: string | null;
    reference_number?: string | null;
    container_number?: string | null;
    po_number?: string | null;
    draft_sequence?: number | null;
    draft_count?: number | null;
    created_at?: string | null;
  } | null;
  receiptLine?: { quantity?: number | null; received_quantity?: number | null; override_length?: number | null; override_width?: number | null; override_height?: number | null; override_weight?: number | null } | null;
  packaging?: { profile_name?: string | null; name?: string | null; unit_name?: string | null; unit_of_measure?: string | null } | null;
  lot: {
    expiry_date: string | null;
    lot_number: string | null;
    batch_number: string | null;
    manufacture_date?: string | null;
  } | null;
  audit: Array<{
    id: string;
    event_type: string;
    created_at: string;
    entity_table: string;
  }>;
};

type PickExecutionData = {
  pickTasks: any[];
};

export function RequireAuth({
  allowedRoles,
}: {
  allowedRoles?: Array<"admin" | "warehouse_manager" | "inventory_clerk" | "warehouse_operator" | "dispatch_driver">;
}) {
  const auth = useAuth();

  if (auth.loading) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,hsl(var(--primary)/0.18),transparent_42%)] blur-3xl" />
        <div className="relative grid h-24 w-24 place-items-center rounded-2xl border border-border bg-card/70 shadow-2xl backdrop-blur-xl">
          <Loader2 className="h-9 w-9 animate-themed-loader" />
        </div>
      </div>
    );
  }

  if (!auth.session) {
    return <Navigate to="/login" replace />;
  }

  const developerEmail = auth.profile?.email?.trim().toLowerCase() === "russelljhunte@gmail.com" || auth.user?.email?.trim().toLowerCase() === "russelljhunte@gmail.com";
  const developerUserCode = auth.profile?.user_code?.trim().toUpperCase() === "DEV01";
  const isDeveloper = auth.roles.includes("developer") || developerEmail || developerUserCode;

  if (!auth.profile || (!auth.profile.approved && !isDeveloper)) {
    return <PendingAccessShell />;
  }

  if (allowedRoles && !auth.hasRole(allowedRoles)) {
    return (
      <AppShell>
        <Card>
          <CardHeader>
            <CardTitle>Permission denied</CardTitle>
            <CardDescription>Your role does not include this workflow.</CardDescription>
          </CardHeader>
        </Card>
      </AppShell>
    );
  }

  return <Outlet />;
}

function PendingAccessShell() {
  const auth = useAuth();
  const { pathname } = useLocation();
  const [checking, setChecking] = useState(false);
  const displayName = auth.profile?.full_name?.trim() || auth.user?.email || "Warehouse User";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "WU";

  const checkAuthorization = async () => {
    setChecking(true);
    try {
      await auth.refreshProfile();
      toast.success("Authorization refreshed. If approved, the workspace will open automatically.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Authorization refresh failed");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="h-screen overflow-hidden bg-background">
      <div className="grid h-full w-full grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden lg:grid-cols-[240px_minmax(0,1fr)] lg:grid-rows-1">
        <header className="col-span-full flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Warehouse className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold">Warehouse Wizard</span>
          </div>
          <div className="flex items-center gap-2">
            <HelpSidebar pathname={pathname} />
            <Button className="h-9 w-9" size="icon" variant="outline" onClick={() => void auth.signOut()} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <aside className="hidden h-full overflow-hidden border-r border-border bg-sidebar px-3 py-3 lg:flex lg:flex-col">
          <div className="mb-4 flex items-center gap-3 px-2">
            <img src="/logo.png" alt="Warehouse Wizard" className="h-8 w-8 shrink-0 rounded-lg object-fill" />
            <span className="truncate text-sm font-semibold text-foreground">Warehouse Wizard</span>
          </div>
          <nav className="flex-1">
            <NavLink
              className={`group flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-all duration-100 ${
                pathname === "/help"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              }`}
              to="/help"
            >
              <HelpCircle className="h-4 w-4 shrink-0" />
              <span className="truncate">Help Center</span>
            </NavLink>
          </nav>
          <Button className="justify-start" variant="ghost" onClick={() => void auth.signOut()}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="hidden items-center justify-between gap-3 border-b border-border bg-background/95 px-5 py-2.5 backdrop-blur lg:flex">
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate text-xs text-muted-foreground">
                <span className="truncate">{pathname === "/help" ? "Help Center" : "Pending Authorization"}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">v{__APP_VERSION__}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <HelpSidebar pathname={pathname} />
              <Button className="h-9 text-xs" variant="outline" onClick={checkAuthorization} disabled={checking}>
                {checking ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                Refresh authorization
              </Button>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-card/80 px-2.5 py-1.5 text-sm">
                <div className="grid h-6 w-6 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials}</div>
                <span className="hidden truncate text-xs font-medium sm:block">{displayName}</span>
                <Button className="h-7 shrink-0 text-xs" variant="ghost" size="sm" onClick={() => void auth.signOut()}>
                  <LogOut className="mr-1 h-3 w-3" />
                  Sign out
                </Button>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 min-w-0 overflow-y-auto px-4 py-5 sm:px-5 lg:px-6">
            <div className="mb-5 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm">
              <p className="font-medium text-foreground">Access request received</p>
              <p className="mt-1 text-muted-foreground">
                Your account is waiting for authorization. Refresh to check whether an admin has approved your access.
              </p>
              <Button className="mt-3" size="sm" onClick={checkAuthorization} disabled={checking}>
                {checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Refresh authorization
              </Button>
            </div>

            {pathname === "/help" ? (
              <HelpCenterPage />
            ) : (
              <Card className="mx-auto max-w-2xl text-center">
                <CardHeader>
                  <CardTitle>Pending Authorization</CardTitle>
                  <CardDescription>
                    The workspace is ready, but operational modules stay locked until an admin approves your account.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm text-muted-foreground">
                  <p>You can open Help Center from the sidebar while you wait.</p>
                  <p>After approval, refresh authorization here or reload the page to enter the full app.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export function LoginPage() {
  const auth = useAuth();
  const [mode, setMode] = useState<"login" | "reset" | "update">(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("reset") === "1" ? "update" : "login",
  );
  const [badgeShortcutAvailable, setBadgeShortcutAvailable] = useState(() => {
    if (typeof window === "undefined") return false;
    return !isDesktopClient() && hasTrustedDeviceShortcut(getOrCreateDeviceId());
  });
  const [loginMethod, setLoginMethod] = useState<"badge" | "code">(() => {
    if (typeof window === "undefined") return "code";
    const badgeAllowed = !isDesktopClient() && hasTrustedDeviceShortcut(getOrCreateDeviceId());
    return badgeAllowed && window.localStorage.getItem(LOGIN_METHOD_STORAGE_KEY) === "badge" ? "badge" : "code";
  });
  const [scannedBadge, setScannedBadge] = useState("");
  const [manualBadge, setManualBadge] = useState("");
  const [badgePin, setBadgePin] = useState("");
  const [badgeScannerError, setBadgeScannerError] = useState<string | null>(null);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(REMEMBER_ME_STORAGE_KEY) !== "0";
  });
  useEffect(() => {
    window.localStorage.setItem(REMEMBER_ME_STORAGE_KEY, rememberMe ? "1" : "0");
  }, [rememberMe]);

  const loginForm = useForm({
    resolver: zodResolver(loginSchema.extend({ email: loginSchema.shape.email.or(z.string().min(3, "Enter an email, user code, or badge")) })),
    defaultValues: { email: "", password: "" },
  });

  const resetForm = useForm({
    resolver: zodResolver(z.object({ email: z.string().email("Enter your account email") })),
    defaultValues: { email: "" },
  });

  const updatePasswordForm = useForm({
    resolver: zodResolver(z.object({ password: loginSchema.shape.password })),
    defaultValues: { password: "" },
  });

  const _signUpForm = useForm({
    resolver: zodResolver(signUpSchema),
    defaultValues: { fullName: "", email: "", phone: "", password: "" },
  });
  void _signUpForm;

  const loginMutation = useMutation({
    mutationFn: async (values: { email: string; password: string }) => {
      const identifier = values.email.trim();
      const method = identifier.toUpperCase().startsWith("BADGE-") ? "badge" : identifier.includes("@") ? "email" : "code";
      if (method === "badge") {
        const { data, error } = await supabase.functions.invoke("badge-login", {
          body: {
            badgeCode: identifier,
            pin: values.password,
            deviceId: getOrCreateDeviceId(),
          },
        });
        if (error) throw error;
        const tokenHash = (data as { token_hash?: string } | null)?.token_hash;
        if (!tokenHash) throw new Error("Badge login could not create a session");
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "email",
        });
        if (verifyError) throw verifyError;
      } else {
        await auth.signIn(identifier, values.password);
        await refreshUserDeviceTrust(getOrCreateDeviceId());
      }
      await recordUserSignIn(method);
    },
    onError: (error) => toast.error(friendlyAuthError(error, "login")),
  });

  const resetMutation = useMutation({
    mutationFn: async (values: { email: string }) => {
      const { error } = await supabase.auth.resetPasswordForEmail(values.email.trim(), {
        redirectTo: `${window.location.origin}/login?reset=1`,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Password reset email sent. Check your inbox for the recovery link.");
      resetForm.reset();
      setMode("login");
    },
    onError: (error) => toast.error(friendlyAuthError(error, "login")),
  });

  const updatePasswordMutation = useMutation({
    mutationFn: async (values: { password: string }) => {
      const { error } = await supabase.auth.updateUser({ password: values.password });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Password updated. Loading your workspace.");
      updatePasswordForm.reset();
      window.history.replaceState({}, "", "/login");
      setMode("login");
    },
    onError: (error) => toast.error(friendlyAuthError(error, "login")),
  });

  const selectedBadge = scannedBadge || manualBadge.trim();
  const rememberLoginMethod = useCallback((method: "badge" | "code") => {
    if (method === "badge" && !badgeShortcutAvailable) {
      toast.error("Badge sign-in requires full login on this mobile or tablet first.");
      return;
    }
    setLoginMethod(method);
    window.localStorage.setItem(LOGIN_METHOD_STORAGE_KEY, method);
  }, [badgeShortcutAvailable]);

  const submitBadgePin = () => {
    if (!selectedBadge) {
      toast.error("Scan or enter a badge code first.");
      return;
    }
    if (!badgeShortcutAvailable) {
      toast.error("Use normal sign-in on this device before badge sign-in.");
      setLoginMethod("code");
      return;
    }
    if (badgePin.length < 4) {
      toast.error("Enter your PIN to continue.");
      return;
    }
    window.localStorage.setItem(LOGIN_METHOD_STORAGE_KEY, "badge");
    loginMutation.mutate({ email: selectedBadge, password: badgePin });
  };

  const handleBadgeScan = useCallback((value: string) => {
    setScannedBadge(value);
    setManualBadge("");
    setBadgePin("");
    if (badgeShortcutAvailable) {
      setPinDialogOpen(true);
      window.localStorage.setItem(LOGIN_METHOD_STORAGE_KEY, "badge");
      toast.success("Badge scanned. Enter your PIN.");
    } else {
      toast.error("Badge sign-in requires full login on this mobile or tablet first.");
      setLoginMethod("code");
    }
  }, [badgeShortcutAvailable]);

  useEffect(() => {
    const available = !isDesktopClient() && hasTrustedDeviceShortcut(getOrCreateDeviceId());
    setBadgeShortcutAvailable(available);
    if (!available && loginMethod === "badge") {
      setLoginMethod("code");
      window.localStorage.setItem(LOGIN_METHOD_STORAGE_KEY, "code");
    }
  }, [loginMethod]);

  if (auth.session && mode !== "update") {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="relative flex h-svh overflow-hidden bg-gradient-to-br from-background via-background to-muted/30">
      {/* Left branding panel — hidden on small screens */}
      <div className="hidden w-2/5 flex-col justify-between bg-primary p-6 text-primary-foreground lg:flex xl:p-8">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="Warehouse Wizard" className="h-[clamp(4.5rem,14vh,8rem)] w-[clamp(4.5rem,14vh,8rem)] rounded-xl bg-background p-1 object-cover" />
          <span className="font-semibold text-3xl font-sans xl:text-4xl">Warehouse Wizard</span>
        </div>
        <div className="space-y-3">
          <h1 className="text-2xl font-bold leading-tight xl:text-3xl">Enterprise Warehouse Management System</h1>
          <p className="text-sm text-primary-foreground/70 xl:text-base">
            Scan-first operations, role-gated workflows, and complete audit trail for modern warehouse teams.
          </p>
          <div className="grid grid-cols-2 gap-2 pt-1 xl:gap-3">
            {[
              ["Pallet tracking", "Real-time location & status"],
              ["Pick & putaway", "Directed task execution"],
              ["Cycle counts", "Variance-aware counting"],
              ["Multi-warehouse", "Unified cross-site control"],
            ].map(([title, desc]) => (
              <div key={title} className="rounded-lg bg-primary-foreground/10 p-2 xl:p-3">
                <p className="text-sm font-medium">{title}</p>
                <p className="mt-0.5 text-xs text-primary-foreground/60">{desc}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-primary-foreground/40">Warehouse Wizard Enterprise WMS</p>
      </div>

      {/* Right login form */}
      <div className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-4 bg-slate-950">
        <div className="w-full max-w-sm space-y-3 sm:space-y-4">
          {/* Mobile logo */}
          <div className="flex flex-col items-center gap-2 lg:hidden">
            <img src="/logo.png" alt="Warehouse Wizard" className="h-[clamp(4.5rem,18vh,7rem)] w-[clamp(4.5rem,18vh,7rem)] rounded-lg object-cover" />
            <span className="font-semibold text-[clamp(1.5rem,7vw,2.25rem)] leading-tight">Warehouse Wizard</span>
          </div>

          <div>
            <h2 className="text-2xl font-bold tracking-tight text-center">
              {mode === "reset" ? "Reset password" : mode === "update" ? "Set new password" : "Welcome back"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground text-center">
              {mode === "reset"
                  ? "Send yourself a secure recovery link."
                  : mode === "update"
                    ? "Choose a new password for your account."
                  : "Use your approved email or user code. Badge sign-in appears only on trusted mobile/tablet devices."}
            </p>
          </div>

          {mode === "login" ? (
            <div className="flex flex-col gap-3">
              <div className={cn("grid gap-2 rounded-lg border border-border bg-secondary/30 p-1", badgeShortcutAvailable ? "grid-cols-2" : "grid-cols-1")}>
                {badgeShortcutAvailable ? (
                  <Button
                    type="button"
                    variant={loginMethod === "badge" ? "default" : "ghost"}
                    className="h-9"
                    onClick={() => rememberLoginMethod("badge")}
                  >
                    <ScanLine className="mr-2 h-4 w-4" />
                    Badge scan
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant={loginMethod === "code" ? "default" : "ghost"}
                  className="h-9"
                  onClick={() => rememberLoginMethod("code")}
                >
                  <Keyboard className="mr-2 h-4 w-4" />
                  User code
                </Button>
              </div>

              {loginMethod === "badge" && badgeShortcutAvailable ? (
                <div className="flex flex-col gap-3">
                  <LoginBadgeScanner onScan={handleBadgeScan} onErrorChange={setBadgeScannerError} scannedCode={selectedBadge} />
                  <div className="rounded-lg border border-border bg-secondary/30 p-2.5">
                    <p className="text-sm font-medium text-center">Badge login</p>
                    <p className="text-xs text-muted-foreground text-center">Scan your badge, then enter your PIN to load the app.</p>
                  </div>
                  {badgeScannerError ? (
                    <div className="rounded-lg border border-border bg-secondary/30 p-2.5">
                      <p className="text-sm font-medium text-center">Badge code</p>
                      <p className="text-xs text-muted-foreground text-center">Badge codes can only be captured by scanner. Use User code if the camera is unavailable.</p>
                    </div>
                  ) : null}
                  {selectedBadge ? (
                    <Button type="button" disabled={loginMutation.isPending} onClick={() => setPinDialogOpen(true)}>
                      Enter PIN
                    </Button>
                  ) : null}
                  <PinKeypadDialog
                    open={pinDialogOpen}
                    pin={badgePin}
                    pending={loginMutation.isPending}
                    onOpenChange={setPinDialogOpen}
                    onPinChange={setBadgePin}
                    onSubmit={submitBadgePin}
                  />
                  <div className="hidden">
                    <label className="text-sm font-medium" htmlFor="badge-pin">PIN</label>
                    <div>
                      <Input
                        id="badge-pin"
                        value={badgePin}
                        type="password"
                        readOnly
                        onChange={(event) => setBadgePin(event.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <Form {...loginForm}>
                  <form className="flex flex-col gap-3" onSubmit={loginForm.handleSubmit((v) => {
                    window.localStorage.setItem(LOGIN_METHOD_STORAGE_KEY, "code");
                    loginMutation.mutate(v);
                  })}>
                    <div className="rounded-lg border border-border bg-secondary/30 p-2.5">
                      <p className="text-sm font-medium text-center">User code or email</p>
                      <p className="text-xs text-muted-foreground text-center">Use an approved email or short code such as ADMIN01.</p>
                    </div>
                    <FormField control={loginForm.control} name="email" render={({ field }) => (
                      <FormItem><FormLabel>Login</FormLabel><FormControl><Input {...field} autoComplete="username" className="bg-secondary bg-slate-500" /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={loginForm.control} name="password" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password or PIN</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input {...field} className="pr-12 bg-secondary bg-slate-500" type={showLoginPassword ? "text" : "password"} autoComplete="current-password" />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground"
                              onClick={() => setShowLoginPassword((current) => !current)}
                              aria-label={showLoginPassword ? "Hide password" : "Show password"}
                              title={showLoginPassword ? "Hide password" : "Show password"}
                            >
                              {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <Button type="submit" disabled={loginMutation.isPending}>
                      {loginMutation.isPending ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
                      Sign in
                    </Button>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
                      <Checkbox
                        checked={rememberMe}
                        onCheckedChange={(value) => setRememberMe(value === true)}
                      />
                      Remember me on this device
                    </label>
                  </form>
                </Form>
              )}
            </div>
          ) : mode === "reset" ? (
            <Form {...resetForm}>
              <form className="space-y-3" onSubmit={resetForm.handleSubmit((v) => resetMutation.mutate(v))}>
                <div className="rounded-lg border border-border bg-secondary/30 p-2.5">
                  <p className="text-sm font-medium text-center">Self-serve recovery</p>
                  <p className="text-xs text-muted-foreground text-center">Use the email tied to your approved warehouse account.</p>
                </div>
                <FormField
                  control={resetForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl><Input {...field} type="email" autoComplete="email" placeholder="jane@example.com" className="bg-secondary bg-slate-500" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={resetMutation.isPending}>
                  {resetMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                  Send reset link
                </Button>
              </form>
            </Form>
          ) : mode === "update" ? (
            <Form {...updatePasswordForm}>
              <form className="space-y-3" onSubmit={updatePasswordForm.handleSubmit((v) => updatePasswordMutation.mutate(v))}>
                <div className="rounded-lg border border-border bg-secondary/30 p-2.5">
                  <p className="text-sm font-medium text-center">Recovery link accepted</p>
                  <p className="text-xs text-muted-foreground text-center">Enter your replacement password to finish account recovery.</p>
                </div>
                <FormField
                  control={updatePasswordForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input {...field} className="pr-12 bg-secondary bg-slate-500" type={showSignUpPassword ? "text" : "password"} autoComplete="new-password" placeholder="Min 8 characters" />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground"
                            onClick={() => setShowSignUpPassword((current) => !current)}
                            aria-label={showSignUpPassword ? "Hide new password" : "Show new password"}
                            title={showSignUpPassword ? "Hide new password" : "Show new password"}
                          >
                            {showSignUpPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={updatePasswordMutation.isPending || !auth.session}>
                  {updatePasswordMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Update password
                </Button>
                {!auth.session ? (
                  <p className="text-center text-xs text-muted-foreground">Open this page from the recovery email link to unlock password update.</p>
                ) : null}
              </form>
            </Form>
          ) : null}

          <p className="text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              <span className="inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                <button className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => setMode("reset")}>
                  Reset password
                </button>
                <span className="text-muted-foreground/60">|</span>
                <span>Admins and Dev users add accounts inside Settings.</span>
              </span>
            ) : mode === "reset" ? (
              <>
                Remembered it?{" "}
                <button className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => setMode("login")}>
                  Sign in
                </button>
              </>
            ) : null}
          </p>
        </div>
      </div>
      <div className="absolute bottom-3 right-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Dialog>
          <DialogTrigger asChild>
            <button className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-primary underline-offset-4 hover:underline">
              <Sparkles className="h-3.5 w-3.5" />
              What's new
            </button>
          </DialogTrigger>
          <DialogContent className="max-h-[86vh] sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>New features</DialogTitle>
              <DialogDescription>Highlights from the latest release.</DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[58vh] pr-4">
              <div className="grid gap-3 text-sm">
                {RELEASE_HISTORY[0].changes.map((change) => (
                  <div key={change} className="rounded-md border border-border px-3 py-2">
                    {change}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
        <span className="text-muted-foreground/60">|</span>
        <Dialog>
          <DialogTrigger asChild>
            <button className="rounded-md px-2 py-1 font-mono font-semibold text-primary underline-offset-4 hover:underline">
              v{__APP_VERSION__}
            </button>
          </DialogTrigger>
          <DialogContent className="max-h-[86vh] sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Version history</DialogTitle>
              <DialogDescription>Warehouse Wizard Enterprise WMS release notes.</DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[58vh] pr-4">
              <div className="grid gap-3">
                {RELEASE_HISTORY.map((release) => (
                  <div key={release.version} className="rounded-lg border border-border p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <Badge variant="secondary" className="font-mono">v{release.version}</Badge>
                      <span className="text-xs text-muted-foreground">{release.date}</span>
                    </div>
                    <ul className="grid gap-1 text-sm text-muted-foreground">
                      {release.changes.map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

export function InventoryDetailPage() {
  const { balanceId = "" } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery<InventoryDetailData>({
    queryKey: ["inventory-detail", balanceId],
    queryFn: async () => (await getInventoryDetail(balanceId)) as unknown as InventoryDetailData,
    enabled: Boolean(balanceId),
  });
  const palletBarcode = data?.pallet?.pallet_barcode ?? data?.pallet?.pallet_code ?? "";
  const productLabel = data?.product?.sku || data?.product?.name
    ? `${data.product?.sku ?? ""}${data.product?.sku && data.product?.name ? " · " : ""}${data.product?.name ?? ""}`
    : "—";
  const clientLabel = data?.client?.code || data?.client?.name
    ? `${data.client?.code ?? ""}${data.client?.code && data.client?.name ? " · " : ""}${data.client?.name ?? ""}`
    : "—";
  const warehouseLabel = data?.warehouse?.code || data?.warehouse?.name
    ? `${data.warehouse?.code ?? ""}${data.warehouse?.code && data.warehouse?.name ? " · " : ""}${data.warehouse?.name ?? ""}`
    : "—";

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
      <Button variant="ghost" className="w-fit -ml-1 gap-1.5 text-muted-foreground" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" /> Back
      </Button>
      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Inventory Detail</CardTitle>
            <CardDescription>Pallet, lot, status, and location context.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {isLoading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : data ? (
              <>
                <div className="flex items-center justify-between gap-4">
                  <span>Pallet</span>
                  <span className="font-mono text-right">{data.pallet?.pallet_code ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Pallet barcode</span>
                  <span className="font-mono text-right">{palletBarcode || "—"}</span>
                </div>
                <PalletBarcodePreview code={palletBarcode} />
                <div className="flex items-center justify-between gap-4">
                  <span>Product</span>
                  <span className="text-right">{productLabel}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Product barcode</span>
                  <span className="font-mono text-right">{data.product?.barcode ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Client</span>
                  <span className="text-right">{clientLabel}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Warehouse</span>
                  <span className="text-right">{warehouseLabel}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Location</span>
                  <span className="font-mono text-right">{data.location?.code ?? "Receiving / not stored"}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Status</span>
                  <Badge>{data.balance.status}</Badge>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Quantity</span>
                  <span>{formatNumber(data.balance.quantity)}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Available</span>
                  <span>{formatNumber(data.balance.available_quantity)}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Received qty</span>
                  <span>{formatNumber(data.receiptLine?.received_quantity ?? data.receiptLine?.quantity ?? data.balance.quantity)}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Receipt</span>
                  <span className="font-mono text-right">{data.receipt?.receipt_number ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Reference</span>
                  <span className="text-right">{data.receipt?.reference_number ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Expiry</span>
                  <span>{formatDate(data.lot?.expiry_date)}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Lot</span>
                  <span>{data.lot?.lot_number ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Batch</span>
                  <span>{data.lot?.batch_number ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Manufactured</span>
                  <span>{formatDate(data.lot?.manufacture_date)}</span>
                </div>
                <div className="grid gap-2 rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-4">
                    <span>Dimensions</span>
                    <span className="text-right">
                      {[data.receiptLine?.override_length ?? data.pallet?.length, data.receiptLine?.override_width ?? data.pallet?.width, data.receiptLine?.override_height ?? data.pallet?.height]
                        .map((value) => value == null ? "—" : formatNumber(value))
                        .join(" × ")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Weight</span>
                    <span>{formatNumber(data.receiptLine?.override_weight ?? data.pallet?.weight)} kg</span>
                  </div>
                </div>
                {palletBarcode && (
                  <PalletLabelPage
                    barcode={palletBarcode}
                    quantity={Number(data.balance.quantity ?? 0)}
                    productSku={data.product?.sku ?? undefined}
                    productName={data.product?.name ?? undefined}
                    lotNumber={data.lot?.lot_number}
                    batchNumber={data.lot?.batch_number}
                    expiryDate={data.lot?.expiry_date}
                    containerNumber={data.receipt?.container_number}
                    poNumber={data.receipt?.po_number}
                    clientName={data.client?.name ?? data.client?.code}
                    warehouseName={data.warehouse ? `${data.warehouse.code ? `${data.warehouse.code} - ` : ""}${data.warehouse.name ?? ""}` : undefined}
                    locationCode={data.location?.code}
                    receiptReference={data.receipt?.reference_number ?? data.receipt?.receipt_number}
                    packaging={data.packaging?.profile_name ?? data.packaging?.name ?? data.packaging?.unit_name ?? data.packaging?.unit_of_measure}
                    draftSequence={data.receipt?.draft_sequence}
                    draftCount={data.receipt?.draft_count}
                    temperatureClass={data.product?.temperature_requirement ?? undefined}
                    trigger={<Button variant="outline">Preview pallet label</Button>}
                  />
                )}
              </>
            ) : null}
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Movement History</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[420px]">
              <div className="grid gap-3">
                {(data?.audit ?? []).map((event) => (
                  <div key={event.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-medium">{event.event_type}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(event.created_at)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{event.entity_table}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
      </div>
    </AppShell>
  );
}

const PICK_OPEN_STATUSES = new Set(["queued", "assigned", "in_progress"]);

export function PickExecutionPage() {
  const { pickListId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data } = useQuery<PickExecutionData>({
    queryKey: ["pick-execution", pickListId],
    queryFn: async () => (await getPickExecution(pickListId)) as unknown as PickExecutionData,
    enabled: Boolean(pickListId),
  });

  // While the operator is on a pick-execution screen, mark active work so
  // background refresh and SW reloads defer until they navigate away.
  useEffect(() => {
    if (!pickListId) return;
    const release = beginActiveWork();
    return () => release();
  }, [pickListId]);

  const tasks = data?.pickTasks ?? [];
  const taskLocationRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [confirmErrorNonceByTask, setConfirmErrorNonceByTask] = useState<Record<string, number>>({});
  const [pickAnomalyByTask, setPickAnomalyByTask] = useState<Record<string, { availableQuantity: number; requestedQuantity: number } | undefined>>({});

  const focusNextOpen = useCallback((justConfirmedId: string) => {
    const list = tasks;
    const idx = list.findIndex((t) => t.id === justConfirmedId);
    const next = list.slice(idx + 1).find((t) => PICK_OPEN_STATUSES.has(t.status));
    if (!next) return;
    const el = taskLocationRefs.current[next.id];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => el.focus(), 250);
    }
  }, [tasks]);

  const mutation = useMutation({
    meta: { offlineQueueable: true },
    mutationFn: async ({
      taskId,
      locationCode,
      palletBarcode,
      quantity,
      shortReason,
      override,
    }: {
      taskId: string;
      locationCode: string;
      palletBarcode: string;
      quantity: number;
      shortReason?: string;
      override?: boolean;
    }) => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        await enqueueOfflineWork("pick", { taskId, pickListId, locationCode, palletBarcode, quantity, shortReason });
        return { queued: true as const };
      }
      try {
        await confirmPickTask(taskId, locationCode, palletBarcode, quantity, shortReason, override);
        return { queued: false as const };
      } catch (err) {
        if (isLikelyNetworkError(err)) {
          await enqueueOfflineWork("pick", { taskId, pickListId, locationCode, palletBarcode, quantity, shortReason });
          return { queued: true as const };
        }
        throw err;
      }
    },
    onSuccess: async (res, variables) => {
      setPickAnomalyByTask((current) => {
        if (!(variables.taskId in current)) return current;
        const next = { ...current };
        delete next[variables.taskId];
        return next;
      });
      if (res?.queued) {
        toast.message("Pick saved offline — will sync on reconnect", {
          description: `Task buffered locally.`,
          duration: 5000,
        });
        try { navigator.vibrate?.([40, 30, 40]); } catch { /* noop */ }
        setTimeout(() => focusNextOpen(variables.taskId), 300);
        return;
      }
      toast.success(variables.override ? "Pick confirmed with override — anomaly logged for review" : "Pick task confirmed");
      try { navigator.vibrate?.([60, 40, 120]); } catch { /* noop */ }
      playPickSuccessTone();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pick-execution", pickListId] }),
        queryClient.invalidateQueries({ queryKey: ["pick-lists"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-search"] }),
        queryClient.invalidateQueries({ queryKey: ["product-qty-totals"] }),
        queryClient.invalidateQueries({ queryKey: ["pick-bay-occupancy"] }),
        queryClient.invalidateQueries({ queryKey: ["bay-occupancy"] }),
        queryClient.invalidateQueries({ queryKey: ["bin-occupancy"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
      ]);
      setTimeout(() => focusNextOpen(variables.taskId), 300);
    },
    onError: (error, variables) => {
      if (variables?.taskId) {
        setConfirmErrorNonceByTask((current) => ({
          ...current,
          [variables.taskId]: (current[variables.taskId] ?? 0) + 1,
        }));
      }
      if (error instanceof PickQuantityAnomalyError && variables?.taskId) {
        setPickAnomalyByTask((current) => ({
          ...current,
          [variables.taskId]: {
            availableQuantity: error.availableQuantity,
            requestedQuantity: error.requestedQuantity,
          },
        }));
        toast.warning(
          `Only ${error.availableQuantity} available on this pallet (requested ${error.requestedQuantity}). Confirm the pallet and override to complete the pick for ${error.availableQuantity}.`,
          { duration: 8000 },
        );
        return;
      }
      toast.error(error instanceof Error ? error.message : "Pick confirmation failed");
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      const { data: openTasks, error: openError } = await supabase
        .from("pick_tasks")
        .select("id, status")
        .eq("pick_list_id", pickListId)
      .in("status", Array.from(PICK_OPEN_STATUSES) as ("queued" | "assigned" | "in_progress")[]);
      if (openError) throw openError;
      if ((openTasks ?? []).length > 0) {
        throw new Error("Confirm every pick task before closing the pick list.");
      }
      const { error } = await supabase
        .from("pick_lists")
        .update({ status: "completed" })
        .eq("id", pickListId);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Pick list complete — handed to dispatch");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pick-execution", pickListId] }),
        queryClient.invalidateQueries({ queryKey: ["pick-lists"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-search"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
      ]);
      navigate("/pick-lists");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not mark complete"),
  });

  const allTasksClosed = tasks.length > 0 && tasks.every((t) => !PICK_OPEN_STATUSES.has(t.status));
  const listStatus = (data as any)?.pickList?.status ?? (tasks[0] as any)?.pick_lists?.status;
  const listAlreadyClosed = listStatus === "completed" || listStatus === "cancelled";

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <Button variant="ghost" className="w-fit -ml-1 gap-1.5 text-muted-foreground" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-semibold">Pick Execution</h2>
            <HintButton label="Pick Execution hints">
              Open the assigned list, scan location and pallet, then confirm quantity.
            </HintButton>
          </div>
          <p className="hidden text-sm text-muted-foreground sm:block">
            Open the assigned list, scan location and pallet, then confirm quantity.
          </p>
        </div>
        {tasks.map((task) => (
          <PickTaskCard
            key={task.id}
            task={task}
            onConfirm={(payload) => mutation.mutate(payload)}
            isPending={mutation.isPending && mutation.variables?.taskId === task.id}
            confirmErrorNonce={confirmErrorNonceByTask[task.id] ?? 0}
            anomaly={pickAnomalyByTask[task.id]}
            onClearAnomaly={() => {
              setPickAnomalyByTask((current) => {
                if (!(task.id in current)) return current;
                const next = { ...current };
                delete next[task.id];
                return next;
              });
            }}
            registerLocationRef={(el) => {
              taskLocationRefs.current[task.id] = el;
            }}
          />
        ))}
        {tasks.length > 0 && (
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              <Button
                className="w-full"
                size="lg"
                disabled={!allTasksClosed || listAlreadyClosed || completeMutation.isPending}
                onClick={() => completeMutation.mutate()}
              >
                {completeMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {listAlreadyClosed ? "Pick list closed" : "Mark pick list complete"}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Marking complete means pallets have been delivered to the dispatch/staging area and are handed off to the ERP.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function PickBayGrid({
  bayCode,
  assignedLocationCode,
  onSelectAssigned,
}: {
  bayCode: string;
  assignedLocationCode: string;
  onSelectAssigned: (locationCode: string) => void;
}) {
  const { data, isFetching } = useQuery({
    queryKey: ["pick-bay-occupancy", bayCode],
    queryFn: () => getBayOccupancy(bayCode),
    enabled: bayCode.trim().length > 0,
    staleTime: 10_000,
  });
  const assigned = assignedLocationCode.trim().toUpperCase();

  if (isFetching) {
    return (
      <div className="lg:col-span-4 rounded-md border border-border bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
        Loading bay locations…
      </div>
    );
  }

  if (!data || data.cells.length === 0) {
    return (
      <div className="lg:col-span-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        No locations found for this bay barcode.
      </div>
    );
  }

  const hasAssignedLocation = data.cells.some((cell: { locationCode: string }) => cell.locationCode.toUpperCase() === assigned);

  return (
    <div className="lg:col-span-4 grid gap-2 rounded-md border border-border bg-secondary/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Bay {data.aisle ?? "?"}-{data.bay ?? "?"}
        </span>
        <span>
          Pick from <span className="font-mono font-semibold text-foreground">{assignedLocationCode || "assigned location"}</span>
        </span>
      </div>
      <div className="grid gap-2">
        {buildBayOccupancyGrid(data.cells).map((row) => (
          <div
            key={`level-${row[0]?.level ?? "unknown"}`}
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}
          >
            {row.map((slot) => {
              const cell = slot.cell;
              if (!cell) {
                return (
                  <div
                    key={`empty-${slot.level}-${slot.position}`}
                    aria-hidden="true"
                    className="min-h-16 rounded-md border border-dashed border-border/60 bg-background/40"
                  />
                );
              }

              const isAssigned = cell.locationCode.toUpperCase() === assigned;
              const canSelect = isAssigned && cell.status === "active";
              return (
                <button
                  key={cell.locationId}
                  type="button"
                  disabled={!canSelect}
                  onClick={() => onSelectAssigned(cell.locationCode)}
                  className={[
                    "min-h-16 rounded-md border px-2 py-2 text-left text-xs transition focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2",
                    isAssigned
                      ? "animate-pulse border-yellow-300 bg-yellow-100 text-yellow-950 ring-2 ring-yellow-300 dark:border-yellow-500 dark:bg-yellow-950/50 dark:text-yellow-50"
                      : "cursor-not-allowed border-muted bg-muted text-muted-foreground opacity-70",
                  ].join(" ")}
                >
                  <span className="block font-mono font-semibold">{cell.locationCode}</span>
                  <span className="mt-1 block">
                    {cell.occupiedPallets}/{cell.maxPallets} pallets
                  </span>
                  <span className="block">{isAssigned ? "Pallet location" : cell.status !== "active" ? cell.status : "Other bin"}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {!hasAssignedLocation ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          The assigned pallet location is not inside this scanned bay.
        </div>
      ) : null}
    </div>
  );
}

function PickTaskCard({
  task,
  onConfirm,
  isPending,
  confirmErrorNonce,
  anomaly,
  onClearAnomaly,
  registerLocationRef,
}: {
  task: any;
  onConfirm: (payload: {
    taskId: string;
    locationCode: string;
    palletBarcode: string;
    quantity: number;
    shortReason?: string;
    override?: boolean;
  }) => void;
  isPending: boolean;
  confirmErrorNonce: number;
  anomaly?: { availableQuantity: number; requestedQuantity: number };
  onClearAnomaly?: () => void;
  registerLocationRef: (el: HTMLInputElement | null) => void;
}) {
  const form = useForm({
    defaultValues: {
      locationCode: "",
      palletBarcode: "",
      quantity: task.requested_quantity,
      shortReason: "",
    },
  });
  const locationRef = useRef<HTMLInputElement | null>(null);
  const palletRef = useRef<HTMLInputElement | null>(null);
  const locationScanButtonRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [confirmPrompt, setConfirmPrompt] = useState(false);
  const [bayScan, setBayScan] = useState("");
  const pallet = task.pallets as any;
  const product = pallet?.products as any;
  const location = task.locations ?? task.pick_balance?.locations ?? null;
  const locationCode = normalizeRackLocationCode(location?.code ?? "");
  const locationDescriptor = describePickLocation(location);
  const palletBarcode = pallet?.pallet_barcode ?? "";
  const palletQuantity = task.pick_balance?.available_quantity ?? pallet?.available_quantity ?? pallet?.quantity ?? task.requested_quantity;
  const wholePalletQuantity = Number(palletQuantity ?? task.requested_quantity ?? 0);
  const isOpen = PICK_OPEN_STATUSES.has(task.status);
  const scannedLocation = String(form.watch("locationCode") ?? "").trim();
  const scannedPallet = String(form.watch("palletBarcode") ?? "").trim();
  const readyToConfirm = Boolean(scannedLocation && scannedPallet);
  const lockForConfirm = confirmPrompt && readyToConfirm;

  useEffect(() => {
    if (confirmErrorNonce > 0) setConfirmPrompt(false);
  }, [confirmErrorNonce]);

  if (!isOpen) {
    const tone =
      task.status === "completed"
        ? "border-l-4 border-l-green-500 bg-muted/40"
        : task.status === "exception"
          ? "border-l-4 border-l-amber-500 bg-muted/40"
          : "border-l-4 border-l-muted-foreground/40 bg-muted/30";
    return (
      <Card className={tone}>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-4">
            <span className="min-w-0 break-all">{task.task_number}</span>
            <Badge variant={task.status === "completed" ? "default" : "secondary"}>{task.status}</Badge>
          </CardTitle>
          <CardDescription>
            {product?.sku ? `${product.sku} · ` : ""}{product?.name ?? "Product"} · {locationCode || "—"} · pallet {palletBarcode || "—"}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
          <div><span className="text-muted-foreground">Requested:</span> {formatNumber(task.requested_quantity)}</div>
          <div><span className="text-muted-foreground">Confirmed:</span> {formatNumber(task.confirmed_quantity ?? 0)}</div>
          {task.short_reason ? (
            <div className="text-amber-600 sm:col-span-1"><span className="text-muted-foreground">Short:</span> {task.short_reason}</div>
          ) : <div />}
        </CardContent>
      </Card>
    );
  }

  const instructionRows = [
    { label: "Go to:", value: locationDescriptor.goTo },
    { label: "Pallet:", value: palletBarcode || "assigned pallet" },
    { label: "Product:", value: `${product?.sku ? `${product.sku} · ` : ""}${product?.name ?? "assigned product"}` },
    { label: "Pallet qty:", value: formatNumber(Number(palletQuantity ?? 0)) },
  ];

  const handleSubmit = form.handleSubmit((values) => {
    if (!readyToConfirm) {
      toast.error("Scan the bay/location and pallet before confirming.");
      return;
    }
    onConfirm({
      taskId: task.id,
      locationCode: values.locationCode,
      palletBarcode: values.palletBarcode,
      quantity: wholePalletQuantity,
    });
    if (cardRef.current) {
      flashInput(cardRef.current, "green");
    }
  });

  function applyLocationScan(value: string) {
    const scanned = normalizeScannerText(value);
    if (!scanned) return;
    onClearAnomaly?.();
    if (isBaySelectorCode(scanned)) {
      setBayScan(scanned);
      form.setValue("locationCode", "");
      setConfirmPrompt(false);
      playBarcodeBeep();
      flashInput(locationScanButtonRef.current, "yellow");
      flashInput(locationRef.current, "yellow");
      return;
    }
    setBayScan("");
    form.setValue("locationCode", scanned);
    setConfirmPrompt(false);
    playBarcodeBeep();
    flashInput(locationRef.current, "blue");
    setTimeout(() => {
      flashInput(palletRef.current, "orange");
      palletRef.current?.focus();
    }, 50);
  }

  return (
    <div ref={cardRef} className="rounded-lg transition-shadow duration-300">
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-4">
          <span className="min-w-0 break-all">{task.task_number}</span>
          <Badge>{task.status}</Badge>
        </CardTitle>
        <CardDescription>Requested quantity: {formatNumber(task.requested_quantity)}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            className="grid gap-4 lg:grid-cols-4"
            onSubmit={handleSubmit}
          >
            <div
              className="lg:col-span-4 grid gap-1.5 rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-sm"
              aria-label="Pick task instructions"
            >
              {instructionRows.map((row) => (
                <div key={row.label} className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
                  <span className="font-semibold text-muted-foreground">{row.label}</span>
                  <span className="min-w-0 break-words text-foreground">{row.value}</span>
                </div>
              ))}
            </div>
            <FormField
              control={form.control}
              name="locationCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bay/Location Code</FormLabel>
                  <FormControl>
                    <div className="flex gap-2">
                      <Input
                        {...field}
                        ref={(el) => {
                          field.ref(el);
                          locationRef.current = el;
                          registerLocationRef(el);
                        }}
                        className="min-h-10 min-w-0 flex-1 transition-shadow duration-300"
                        disabled={lockForConfirm}
                        placeholder="Scan location barcode"
                        onChange={(event) => {
                          const value = normalizeScannerText(event.target.value.replace(/[\r\n]/g, ""));
                          if (/^BAY:[^:]+:[^:]+:[^:]+:[^:]+$/i.test(value.trim())) {
                            applyLocationScan(value);
                            return;
                          }
                          if (!value.toUpperCase().startsWith("BAY:")) setBayScan("");
                          field.onChange(value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            applyLocationScan(event.currentTarget.value);
                          }
                        }}
                      />
                      <div ref={locationScanButtonRef} className="rounded-md transition-shadow duration-300">
                        <BarcodeScanButton
                          title="Scan Bay/Location Code"
                          onScan={applyLocationScan}
                          disabled={lockForConfirm}
                        />
                      </div>
                    </div>
                  </FormControl>
                </FormItem>
              )}
            />
            {bayScan ? (
              <PickBayGrid
                bayCode={bayScan}
                assignedLocationCode={locationCode}
                onSelectAssigned={(selectedLocation) => {
                  setBayScan("");
                  form.setValue("locationCode", selectedLocation);
                  setConfirmPrompt(false);
                  playBarcodeBeep();
                  flashInput(locationRef.current, "yellow");
                  setTimeout(() => {
                    flashInput(palletRef.current, "orange");
                    palletRef.current?.focus();
                  }, 50);
                }}
              />
            ) : null}
            <FormField
              control={form.control}
              name="palletBarcode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Pallet barcode</FormLabel>
                  <FormControl>
                    <div className="flex gap-2">
                      <Input
                        {...field}
                        ref={(el) => {
                          field.ref(el);
                          palletRef.current = el;
                        }}
                        className="min-h-10 min-w-0 flex-1 transition-shadow duration-300"
                        disabled={lockForConfirm}
                        placeholder="Scan pallet barcode"
                        onChange={(event) => {
                          onClearAnomaly?.();
                          field.onChange(normalizeScannerText(event.target.value.replace(/[\r\n]/g, "")));
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            playBarcodeBeep();
                            flashInput(palletRef.current, "blue");
                            setConfirmPrompt(true);
                            setTimeout(() => {
                              flashInput(confirmRef.current, "yellow");
                              confirmRef.current?.focus();
                            }, 50);
                          }
                        }}
                      />
                      <BarcodeScanButton
                        title="Scan pallet barcode"
                        onScan={(value) => {
                          form.setValue("palletBarcode", normalizeScannerText(value));
                          playBarcodeBeep();
                          flashInput(palletRef.current, "blue");
                          setConfirmPrompt(true);
                          setTimeout(() => {
                            flashInput(confirmRef.current, "yellow");
                            confirmRef.current?.focus();
                          }, 50);
                        }}
                        disabled={lockForConfirm}
                      />
                    </div>
                  </FormControl>
                </FormItem>
              )}
            />
            <div className="lg:col-span-2 grid gap-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Full pallet qty</span>
              <span className="font-mono text-base font-semibold">{formatNumber(wholePalletQuantity)}</span>
            </div>
            {anomaly ? (
              <div className="lg:col-span-4 flex flex-col gap-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-200">
                <p>
                  <AlertTriangle className="mr-1 inline h-4 w-4" />
                  This pallet has already been debited — only <span className="font-mono font-semibold">{formatNumber(anomaly.availableQuantity)}</span> is
                  available now (requested <span className="font-mono font-semibold">{formatNumber(anomaly.requestedQuantity)}</span>). Re-check the physical
                  pallet, then override to complete the pick for the actual quantity. This will log a record-count warning for admins and managers to review.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="w-fit border-amber-500 text-amber-900 hover:bg-amber-100 dark:text-amber-200"
                  disabled={isPending || !readyToConfirm}
                  onClick={() =>
                    onConfirm({
                      taskId: task.id,
                      locationCode: scannedLocation,
                      palletBarcode: scannedPallet,
                      quantity: anomaly.availableQuantity,
                      override: true,
                    })
                  }
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Override & confirm {formatNumber(anomaly.availableQuantity)}
                </Button>
              </div>
            ) : null}
            <Button
              ref={confirmRef}
              className={cn(
                "w-full lg:col-span-4",
                confirmPrompt && readyToConfirm && "animate-pulse border border-yellow-300 bg-yellow-300 text-yellow-950 hover:bg-yellow-300",
              )}
              type="submit"
              disabled={isPending || !readyToConfirm}
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirm pick
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
    </div>
  );
}

export function HomeRedirect() {
  const { session } = useAuth();
  return <Navigate to={session ? "/dashboard" : "/login"} replace />;
}

export function FeatureFlagProvider({ children }: { children: ReactNode }) {
  const value = useFeatureFlagState();
  return <FeatureFlagContext.Provider value={value}>{children}</FeatureFlagContext.Provider>;
}

export function RuntimeModeBadge() {
  // Read the hostname after hydration so server and client render the same
  // initial tree (SSR always renders nothing; the badge appears post-mount).
  const [hostname, setHostname] = useState("");
  useEffect(() => {
    setHostname(window.location.hostname.toLowerCase());
  }, []);
  const isLocal =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
  if (!isLocal) return null;

  return (
    <div
      className={cn("pointer-events-none fixed inset-x-0 bottom-0 z-[70] h-[3px] bg-orange-500")}
      title="Warehouse Wizard is running locally"
      aria-hidden="true"
    />
  );
}

