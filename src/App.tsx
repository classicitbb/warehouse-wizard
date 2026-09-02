import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RELEASE_HISTORY } from "@/lib/release-history";
import { RouteErrorBoundary } from "@/components/error-boundary";
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Eye,
  EyeOff,
  HelpCircle,
  Loader2,
  LogOut,
  Mail,
  RefreshCw,
  ScanLine,
  Sparkles,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Analytics } from "@vercel/analytics/react";
import { QRCodeSVG } from "qrcode.react";


import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { FeatureFlagContext, useFeatureFlagState } from "@/hooks/use-feature-flags";
import { OFFLINE_WORK_MESSAGE, assertOnline, useNetworkStatus } from "@/hooks/use-network-status";
import { useTenantPath } from "@/hooks/use-tenant-path";
import { isLikelyNetworkError } from "@/lib/offline-queue";
import { supabase } from "@/integrations/supabase/client";
import { createAppQueryClient } from "@/lib/query-client";

import {
  buildBayOccupancyGrid,
  confirmPickTask,
  createPickShortfallTask,
  formatDate,
  formatDateTime,

  formatNumber,
  formatPickRackInstruction,
  getBayOccupancy,
  getInventoryDetail,
  getPickExecution,
  loginSchema,
  normalizeRackLocationCode,
  PickQuantityAnomalyError,
  previewPickSourceOverride,
  recordUserSignIn,
  refreshUserDeviceTrust,
  signUpSchema,
  RESOURCE_DEFINITIONS,
} from "@/lib/wms-core";
import { beginActiveWork } from "@/lib/active-work";
import {
  clearPickTaskResumeSnapshot,
  loadPickTaskResumeSnapshot,
  savePickTaskResumeSnapshot,
} from "@/lib/floor-task-resume";
import { getOrCreateDeviceId, hasTrustedDeviceShortcut, isDesktopClient } from "@/lib/device-identity";
import { cn } from "@/lib/utils";
import { normalizePalletBarcode, palletBarcodeError } from "@/lib/code-input";
import { alertToast } from "@/features/shared/ui-shared";
import { PalletEditDialog, type PalletEditTarget } from "@/features/inventory/pallet-edit-dialog";
import { palletEditBlockedReason, palletOutsideStaging, PUTAWAY_STAGING_LOCATION_CODE, STAGING_EDIT_HINT } from "@/features/inventory/pallet-edit-rules";

import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { AiHintFailureAlert } from "@/components/ai-hint-alert";
import { ConnectionRecovery, WhatsNewOnUpdate } from "@/features/shared/app-runtime";

import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BarcodeScanButton } from "@/components/barcode-scan-button";
import { HelpSidebar } from "@/components/help-sidebar";
import { HintButton } from "@/components/hint-button";
import NotFound from "./pages/NotFound";
import { APP_REFRESH_EVENT } from "@/lib/preview-env";

const queryClient = createAppQueryClient();

// Soft refresh: inside the preview iframe a hard reload breaks the token-bearing
// proxy URL, so refresh requests re-fetch data instead of reloading the page.
if (typeof window !== "undefined") {
  window.addEventListener(APP_REFRESH_EVENT, () => {
    void queryClient.invalidateQueries();
  });
}

/** Full-page loading spinner shown while lazy chunks are fetched. */
function PageSpinner() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading…" />
    </div>
  );
}

// Each route points at its own feature module, not the `wms-ui` barrel. Routing
// every lazy() through one barrel collapsed all 15 pages into a single 554 kB
// chunk, so the first navigation downloaded every screen in the app.
const DashboardPage = lazy(() => import("@/features/dashboard/dashboard-page").then((mod) => ({ default: mod.DashboardPage })));
const AppShell = lazy(() => import("@/features/shared/app-shell").then((mod) => ({ default: mod.AppShell })));
const InventorySearchPage = lazy(() =>
  import("@/features/inventory/inventory-page").then((mod) => ({ default: mod.InventorySearchPage })),
);
const PickListsPage = lazy(() => import("@/features/picking/picking-page").then((mod) => ({ default: mod.PickListsPage })));
const PutawayTasksPage = lazy(() => import("@/features/putaway/putaway-page").then((mod) => ({ default: mod.PutawayTasksPage })));
const ReceivingPage = lazy(() => import("@/features/receiving/receiving-page").then((mod) => ({ default: mod.ReceivingPage })));
const ReportsPage = lazy(() => import("@/features/status/status-page").then((mod) => ({ default: mod.ReportsPage })));
const ResourcePage = lazy(() => import("@/features/resources/resource-page").then((mod) => ({ default: mod.ResourcePage })));
const SettingsPage = lazy(() => import("@/features/admin/admin-page").then((mod) => ({ default: mod.SettingsPage })));
const StatusPage = lazy(() => import("@/features/status/status-page").then((mod) => ({ default: mod.StatusPage })));
const SystemLogPage = lazy(() => import("@/features/system/system-page").then((mod) => ({ default: mod.SystemLogPage })));
const EmailLogPage = lazy(() => import("@/features/system/system-page").then((mod) => ({ default: mod.EmailLogPage })));
const TransfersPage = lazy(() => import("@/features/transfers/transfers-page").then((mod) => ({ default: mod.TransfersPage })));
const UsersRolesPage = lazy(() => import("@/features/admin/admin-page").then((mod) => ({ default: mod.UsersRolesPage })));
const CycleCountsPage = lazy(() => import("@/features/cycle-counts/cycle-counts-page").then((mod) => ({ default: mod.CycleCountsPage })));
const LocationMovesPage = lazy(() => import("@/features/moves/moves-page").then((mod) => ({ default: mod.LocationMovesPage })));
const PalletLabelPage = lazy(() =>
  import("@/components/pallet-label-page").then((mod) => ({ default: mod.PalletLabelPage })),
);
const HelpCenterPage = lazy(() => import("./pages/HelpCenter"));
const SetupWizardPage = lazy(() => import("./pages/SetupWizardPage"));
const OAuthConsentPage = lazy(() => import("./pages/OAuthConsent"));
const ProtectedShell = lazy(() =>
  Promise.all([
    import("@/features/shared/app-shell"),
    import("@/features/admin/admin-page"),
  ]).then(([shell, admin]) => ({
    default: function ProtectedShellComponent({ children }: { children: ReactNode }) {
      return (
        <shell.AppShell>
          {children}
          <admin.MobileActionBar />
        </shell.AppShell>
      );
    },
  })),
);


const ANDROID_APP_DOWNLOAD_URL = "https://classicitbb.github.io/threeplmgmt/";

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
    gain.gain.setValueAtTime(0.9, ctx.currentTime);
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
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function isBaySelectorCode(value: string) {
  const normalized = normalizeScannerText(value);
  if (normalized.startsWith("BAY:")) return true;
  const parts = normalized.split("-").filter(Boolean);
  if (parts.length === 2 && /^\d+$/.test(parts[1])) return true;
  return parts.length >= 4 && !parts.some((part) => /^L\d+$/i.test(part));
}

function describePickLocation(
  location:
    | {
        code?: string | null;
        aisle?: string | number | null;
        bay?: string | number | null;
        level?: string | number | null;
        position?: string | number | null;
      }
    | null
    | undefined,
) {
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
  "qr_code",
  "code_128",
  "code_39",
  "code_93",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "data_matrix",
  "pdf417",
  "aztec",
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

      detectorRef.current = new (window as any).BarcodeDetector({
        formats: formats.length ? formats : LOGIN_BARCODE_FORMATS,
      });

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
              <Button
                key={digit}
                type="button"
                variant="outline"
                className="h-14 text-xl"
                onClick={() => appendDigit(digit)}
              >
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
    correction_state?: "pending" | "superseded" | null;
  };
  pallet: {
    pallet_code: string | null;
    pallet_barcode: string | null;
    length?: number | null;
    width?: number | null;
    height?: number | null;
    weight?: number | null;
    correction_state?: "pending" | "superseded" | null;
  } | null;
  product?: {
    sku?: string | null;
    name?: string | null;
    barcode?: string | null;
    temperature_requirement?: string | null;
  } | null;
  client?: { code?: string | null; name?: string | null } | null;
  warehouse?: { code?: string | null; name?: string | null } | null;
  location?: { code?: string | null; aisle?: string | null; bay?: string | null; level?: string | null; location_type?: string | null } | null;
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
  receiptLine?: {
    quantity?: number | null;
    received_quantity?: number | null;
    override_length?: number | null;
    override_width?: number | null;
    override_height?: number | null;
    override_weight?: number | null;
  } | null;
  packaging?: {
    profile_name?: string | null;
    name?: string | null;
    unit_name?: string | null;
    unit_of_measure?: string | null;
  } | null;
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

function RequireAuth({
  allowedRoles,
}: {
  allowedRoles?: Array<"admin" | "warehouse_manager" | "inventory_clerk" | "warehouse_operator" | "dispatch_driver">;
}) {
  const auth = useAuth();
  const { toPath } = useTenantPath();

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
    return <Navigate to={toPath("/login")} replace />;
  }

  const developerEmail =
    auth.profile?.email?.trim().toLowerCase() === "russelljhunte@gmail.com" ||
    auth.user?.email?.trim().toLowerCase() === "russelljhunte@gmail.com";
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
  const { toPath } = useTenantPath();
  const [checking, setChecking] = useState(false);
  const displayName = auth.profile?.full_name?.trim() || auth.user?.email || "Warehouse User";
  const initials =
    displayName
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
            <Button
              className="h-9 w-9"
              size="icon"
              variant="outline"
              onClick={() => void auth.signOut()}
              aria-label="Sign out"
            >
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
              className={({ isActive }) =>
                `group flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-all duration-100 ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`
              }
              to={toPath("/help")}
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
                {checking ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                )}
                Refresh authorization
              </Button>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-card/80 px-2.5 py-1.5 text-sm">
                <div className="grid h-6 w-6 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {initials}
                </div>
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

function LoginPage() {
  const auth = useAuth();
  const { toPath } = useTenantPath();
  const [mode, setMode] = useState<"login" | "reset" | "update">(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("reset") === "1"
      ? "update"
      : "login",
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
  const showAndroidAppLink = useMemo(() => {
    if (typeof window === "undefined") return false;
    const navigatorWithUserAgentData = navigator as Navigator & { userAgentData?: { platform?: string } };
    const userAgentText = `${navigator.userAgent ?? ""} ${navigatorWithUserAgentData.userAgentData?.platform ?? ""}`;
    const isAndroid = /android/i.test(userAgentText);
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      document.referrer.startsWith("android-app://") ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return isAndroid && !isStandalone;
  }, []);
  useEffect(() => {
    window.localStorage.setItem(REMEMBER_ME_STORAGE_KEY, rememberMe ? "1" : "0");
  }, [rememberMe]);

  const loginForm = useForm({
    resolver: zodResolver(
      loginSchema.extend({
        email: loginSchema.shape.email.or(z.string().min(3, "Enter an email, user code, or badge")),
      }),
    ),
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
      const method = identifier.toUpperCase().startsWith("BADGE-")
        ? "badge"
        : identifier.includes("@")
          ? "email"
          : "code";
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
        // Device-trust refresh is best-effort — never fail login if the
        // trust-device edge function is unreachable (CORS/network/etc).
        try {
          await refreshUserDeviceTrust(getOrCreateDeviceId());
        } catch (trustError) {
          console.warn("[login] device trust refresh skipped:", trustError);
        }
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
  const rememberLoginMethod = useCallback(
    (method: "badge" | "code") => {
      if (method === "badge" && !badgeShortcutAvailable) {
        toast.error("Badge sign-in requires full login on this mobile or tablet first.");
        return;
      }
      setLoginMethod(method);
      window.localStorage.setItem(LOGIN_METHOD_STORAGE_KEY, method);
    },
    [badgeShortcutAvailable],
  );

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

  const handleBadgeScan = useCallback(
    (value: string) => {
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
    },
    [badgeShortcutAvailable],
  );

  useEffect(() => {
    const available = !isDesktopClient() && hasTrustedDeviceShortcut(getOrCreateDeviceId());
    setBadgeShortcutAvailable(available);
    if (!available && loginMethod === "badge") {
      setLoginMethod("code");
      window.localStorage.setItem(LOGIN_METHOD_STORAGE_KEY, "code");
    }
  }, [loginMethod]);

  if (auth.session && mode !== "update") {
    const nextParam = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("next") : null;
    const target = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";
    return <Navigate to={toPath(target)} replace />;
  }

  return (
    <div className="relative flex h-svh overflow-hidden bg-gradient-to-br from-background via-background to-muted/30">
      {/* Left branding panel — hidden on small screens */}
      <div className="hidden w-2/5 flex-col justify-between bg-primary p-6 text-primary-foreground lg:flex xl:p-8">
        <div className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt="Warehouse Wizard"
            className="h-[clamp(4.5rem,14vh,8rem)] w-[clamp(4.5rem,14vh,8rem)] object-contain"
          />
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
            <img
              src="/logo.png"
              alt="Warehouse Wizard"
              className="h-[clamp(4.5rem,18vh,7rem)] w-[clamp(4.5rem,18vh,7rem)] rounded-lg object-cover"
            />
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
              {loginMethod === "badge" && badgeShortcutAvailable ? (
                <div className="flex flex-col gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => rememberLoginMethod("code")}
                  >
                    Back to sign in
                  </Button>
                  <LoginBadgeScanner
                    onScan={handleBadgeScan}
                    onErrorChange={setBadgeScannerError}
                    scannedCode={selectedBadge}
                  />
                  <div className="rounded-lg border border-border bg-secondary/30 p-2.5">
                    <p className="text-sm font-medium text-center">Badge login</p>
                    <p className="text-xs text-muted-foreground text-center">
                      Scan your badge, then enter your PIN to load the app.
                    </p>
                  </div>
                  {badgeScannerError ? (
                    <div className="rounded-lg border border-border bg-secondary/30 p-2.5">
                      <p className="text-sm font-medium text-center">Badge code</p>
                      <p className="text-xs text-muted-foreground text-center">
                        Badge codes can only be captured by scanner. Use User code if the camera is unavailable.
                      </p>
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
                    <label className="text-sm font-medium" htmlFor="badge-pin">
                      PIN
                    </label>
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
                  <form
                    className="flex flex-col gap-3"
                    onSubmit={loginForm.handleSubmit((v) => {
                      window.localStorage.setItem(LOGIN_METHOD_STORAGE_KEY, "code");
                      loginMutation.mutate(v);
                    })}
                  >
                    {badgeShortcutAvailable ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={() => rememberLoginMethod("badge")}
                      >
                        <ScanLine className="mr-2 h-4 w-4" />
                        Use badge scan
                      </Button>
                    ) : null}
                    <FormField
                      control={loginForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Login</FormLabel>
                          <FormControl>
                            <Input {...field} autoComplete="username" className="bg-secondary bg-slate-500" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={loginForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password or PIN</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                {...field}
                                className="pr-12 bg-secondary bg-slate-500"
                                type={showLoginPassword ? "text" : "password"}
                                autoComplete="current-password"
                              />
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
                      )}
                    />
                    <Button type="submit" disabled={loginMutation.isPending}>
                      {loginMutation.isPending ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
                      Sign in
                    </Button>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
                      <Checkbox checked={rememberMe} onCheckedChange={(value) => setRememberMe(value === true)} />
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
                  <p className="text-xs text-muted-foreground text-center">
                    Use the email tied to your approved warehouse account.
                  </p>
                </div>
                <FormField
                  control={resetForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="email"
                          autoComplete="email"
                          placeholder="jane@example.com"
                          className="bg-secondary bg-slate-500"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={resetMutation.isPending}>
                  {resetMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Mail className="mr-2 h-4 w-4" />
                  )}
                  Send reset link
                </Button>
              </form>
            </Form>
          ) : mode === "update" ? (
            <Form {...updatePasswordForm}>
              <form
                className="space-y-3"
                onSubmit={updatePasswordForm.handleSubmit((v) => updatePasswordMutation.mutate(v))}
              >
                <div className="rounded-lg border border-border bg-secondary/30 p-2.5">
                  <p className="text-sm font-medium text-center">Recovery link accepted</p>
                  <p className="text-xs text-muted-foreground text-center">
                    Enter your replacement password to finish account recovery.
                  </p>
                </div>
                <FormField
                  control={updatePasswordForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            {...field}
                            className="pr-12 bg-secondary bg-slate-500"
                            type={showSignUpPassword ? "text" : "password"}
                            autoComplete="new-password"
                            placeholder="Min 8 characters"
                          />
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
                  <p className="text-center text-xs text-muted-foreground">
                    Open this page from the recovery email link to unlock password update.
                  </p>
                ) : null}
              </form>
            </Form>
          ) : null}

          <p className="text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              <span className="inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                <button
                  className="font-medium text-primary underline-offset-4 hover:underline"
                  onClick={() => setMode("reset")}
                >
                  Reset password
                </button>
                <span className="text-muted-foreground/60">|</span>
                <span>Admins and Dev users add accounts inside Settings.</span>
              </span>
            ) : mode === "reset" ? (
              <>
                Remembered it?{" "}
                <button
                  className="font-medium text-primary underline-offset-4 hover:underline"
                  onClick={() => setMode("login")}
                >
                  Sign in
                </button>
              </>
            ) : null}
          </p>
        </div>
      </div>
      <div className="absolute bottom-3 right-3 flex items-center gap-2 text-xs text-muted-foreground">
        {showAndroidAppLink ? (
          <>
            <Button variant="outline" size="sm" asChild>
              <a href={ANDROID_APP_DOWNLOAD_URL}>Android app</a>
            </Button>
            <span className="text-muted-foreground/60">|</span>
          </>
        ) : null}
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
                {(RELEASE_HISTORY[0].fixes ?? []).map((fix) => (
                  <div key={fix} className="rounded-md border border-border bg-muted/40 px-3 py-2 text-muted-foreground">
                    Fix: {fix}
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
                      <Badge variant="secondary" className="font-mono">
                        v{release.version}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{release.date}</span>
                    </div>
                    <ul className="grid gap-1 text-sm text-muted-foreground">
                      {release.changes.map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                    {release.fixes?.length ? (
                      <>
                        <p className="mt-2 text-xs font-medium uppercase text-muted-foreground">Fixes</p>
                        <ul className="grid gap-1 text-sm text-muted-foreground">
                          {release.fixes.map((fix) => (
                            <li key={fix}>{fix}</li>
                          ))}
                        </ul>
                      </>
                    ) : null}
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

function InventoryDetailPage() {
  const { balanceId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { roles } = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const { data, isLoading } = useQuery<InventoryDetailData>({
    queryKey: ["inventory-detail", balanceId],
    queryFn: async () => (await getInventoryDetail(balanceId)) as unknown as InventoryDetailData,
    enabled: Boolean(balanceId),
  });
  const palletBarcode = data?.pallet?.pallet_barcode ?? data?.pallet?.pallet_code ?? "";
  const productLabel =
    data?.product?.sku || data?.product?.name
      ? `${data.product?.sku ?? ""}${data.product?.sku && data.product?.name ? " · " : ""}${data.product?.name ?? ""}`
      : "—";
  const clientLabel =
    data?.client?.code || data?.client?.name
      ? `${data.client?.code ?? ""}${data.client?.code && data.client?.name ? " · " : ""}${data.client?.name ?? ""}`
      : "—";
  const warehouseLabel =
    data?.warehouse?.code || data?.warehouse?.name
      ? `${data.warehouse?.code ?? ""}${data.warehouse?.code && data.warehouse?.name ? " · " : ""}${data.warehouse?.name ?? ""}`
      : "—";
  const canReceive = roles.some((role) =>
    [
      "developer",
      "dev",
      "admin",
      "warehouse_manager",
      "warehouse_supervisor",
      "supervisor",
      "inventory_clerk",
    ].includes(role),
  );
  // A pending edit is resumable rather than blocked — reopening it picks the
  // same draft back up instead of reserving a second pallet number.
  const correctionBlockedReason = data
    ? palletEditBlockedReason({
        hasPallet: Boolean(data.pallet),
        balanceCorrectionState: data.balance.correction_state ?? null,
        palletCorrectionState: data.pallet?.correction_state ?? null,
        balanceStatus: data.balance.status,
        reservedQuantity: data.balance.reserved_quantity ?? 0,
        availableQuantity: data.balance.available_quantity ?? 0,
        locationCode: data.location?.code ?? null,
        locationType: data.location?.location_type ?? null,
      })
    : "";
  const outsideStaging = palletOutsideStaging({
    locationCode: data?.location?.code ?? null,
    locationType: data?.location?.location_type ?? null,
  });
  const showStagingHint = Boolean(
    correctionBlockedReason &&
    outsideStaging &&
    data?.balance.correction_state !== "pending" &&
    data?.pallet?.correction_state !== "pending",
  );
  const editTarget: PalletEditTarget | null = data?.pallet
    ? {
        balanceId,
        palletBarcode,
        quantity: Number(data.balance.quantity ?? 0),
        expiryDate: data.lot?.expiry_date ?? null,
        productSku: data.product?.sku ?? null,
        productName: data.product?.name ?? null,
        lotNumber: data.lot?.lot_number ?? null,
        batchNumber: data.lot?.batch_number ?? null,
        clientName: data.client?.name ?? data.client?.code ?? null,
        warehouseName: data.warehouse
          ? `${data.warehouse.code ? `${data.warehouse.code} - ` : ""}${data.warehouse.name ?? ""}`
          : null,
        locationCode: data.location?.code ?? null,
        containerNumber: data.receipt?.container_number ?? null,
        poNumber: data.receipt?.po_number ?? null,
        receiptReference: data.receipt?.reference_number ?? data.receipt?.receipt_number ?? null,
        packaging:
          data.packaging?.profile_name ??
          data.packaging?.name ??
          data.packaging?.unit_name ??
          data.packaging?.unit_of_measure ??
          null,
        temperatureClass: data.product?.temperature_requirement ?? undefined,
        correctionPending:
          data.balance.correction_state === "pending" || data.pallet?.correction_state === "pending",
      }
    : null;

  // Receiving hands a pending edit back here rather than editing it there.
  const canOpenEdit = Boolean(editTarget) && !correctionBlockedReason;
  useEffect(() => {
    if (searchParams.get("edit") !== "1" || !canOpenEdit) return;
    setEditOpen(true);
    setSearchParams({}, { replace: true });
  }, [canOpenEdit, searchParams, setSearchParams]);

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
                    <span>
                      {formatNumber(
                        data.receiptLine?.received_quantity ?? data.receiptLine?.quantity ?? data.balance.quantity,
                      )}
                    </span>
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
                        {[
                          data.receiptLine?.override_length ?? data.pallet?.length,
                          data.receiptLine?.override_width ?? data.pallet?.width,
                          data.receiptLine?.override_height ?? data.pallet?.height,
                        ]
                          .map((value) => (value == null ? "—" : formatNumber(value)))
                          .join(" × ")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span>Weight</span>
                      <span>{formatNumber(data.receiptLine?.override_weight ?? data.pallet?.weight)} kg</span>
                    </div>
                  </div>
                  {palletBarcode && (
                    <div className="flex flex-wrap gap-2">
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
                        warehouseName={
                          data.warehouse
                            ? `${data.warehouse.code ? `${data.warehouse.code} - ` : ""}${data.warehouse.name ?? ""}`
                            : undefined
                        }
                        locationCode={data.location?.code}
                        receiptReference={data.receipt?.reference_number ?? data.receipt?.receipt_number}
                        packaging={
                          data.packaging?.profile_name ??
                          data.packaging?.name ??
                          data.packaging?.unit_name ??
                          data.packaging?.unit_of_measure
                        }
                        draftSequence={data.receipt?.draft_sequence}
                        draftCount={data.receipt?.draft_count}
                        temperatureClass={data.product?.temperature_requirement ?? undefined}
                        trigger={<Button variant="outline">Preview pallet label</Button>}
                      />
                    </div>
                  )}
                  {canReceive && (
                    <div className="flex flex-col gap-2">
                      <Button
                        variant="outline"
                        className="w-fit"
                        disabled={Boolean(correctionBlockedReason)}
                        title={
                          correctionBlockedReason || "Edit this pallet's quantity or expiry, or send it back to Drafts"
                        }
                        onClick={() => setEditOpen(true)}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Edit pallet
                      </Button>
                      {showStagingHint && data?.pallet && data.location?.code ? (
                        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
                          <p className="text-amber-700 dark:text-amber-400">{STAGING_EDIT_HINT}</p>
                          <Button size="sm" variant="link" className="mt-1 h-auto px-0 text-xs" asChild>
                            <Link
                              to={`/location-moves?pallet=${encodeURIComponent(palletBarcode)}&bay=${encodeURIComponent(PUTAWAY_STAGING_LOCATION_CODE)}&from=${encodeURIComponent(`/inventory/${balanceId}`)}`}
                            >
                              Go to Location Moves
                            </Link>
                          </Button>
                        </div>
                      ) : null}
                    </div>
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
                        <span className="text-xs text-muted-foreground">{formatDateTime(event.created_at)}</span>
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
      <PalletEditDialog open={editOpen} onOpenChange={setEditOpen} target={editTarget} />
    </AppShell>
  );
}

const PICK_OPEN_STATUSES = new Set(["queued", "assigned", "in_progress"]);

function PickExecutionPage() {
  const { pickListId = "" } = useParams();
  const navigate = useNavigate();
  const { toPath } = useTenantPath();
  const queryClient = useQueryClient();
  const { online } = useNetworkStatus();
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
  const expectedPickListCode = String((data as any)?.pickList?.pick_list_number ?? "");
  const taskLocationRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [confirmErrorNonceByTask, setConfirmErrorNonceByTask] = useState<Record<string, number>>({});
  const [pickAnomalyByTask, setPickAnomalyByTask] = useState<
    Record<string, { availableQuantity: number; requestedQuantity: number } | undefined>
  >({});
  const [shortfallPrompt, setShortfallPrompt] = useState<{ taskId: string; quantity: number } | null>(null);

  const focusNextOpen = useCallback(
    (justConfirmedId: string) => {
      const list = tasks;
      const idx = list.findIndex((t) => t.id === justConfirmedId);
      const next = list.slice(idx + 1).find((t) => PICK_OPEN_STATUSES.has(t.status));
      if (!next) return;
      const el = taskLocationRefs.current[next.id];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => el.focus(), 250);
      }
    },
    [tasks],
  );

  const mutation = useMutation({
    mutationFn: async ({
      taskId,
      locationCode,
      palletBarcode,
      quantity,
      override,
      confirmSourceOverride,
      allowSourceQuantityVariance,
      pickListCode,
    }: {
      taskId: string;
      locationCode: string;
      palletBarcode: string;
      quantity: number;
      override?: boolean;
      confirmSourceOverride?: boolean;
      allowSourceQuantityVariance?: boolean;
      pickListCode: string;
    }) => {
      assertOnline();
      try {
        return await confirmPickTask(
          taskId,
          pickListCode,
          palletBarcode,
          quantity,
          Boolean(override),
          Boolean(confirmSourceOverride),
          Boolean(allowSourceQuantityVariance),
        );
      } catch (err) {
        if (isLikelyNetworkError(err)) {
          throw new Error(OFFLINE_WORK_MESSAGE);
        }
        throw err;
      }
    },
    onSuccess: async (result: any, variables) => {
      setPickAnomalyByTask((current) => {
        if (!(variables.taskId in current)) return current;
        const next = { ...current };
        delete next[variables.taskId];
        return next;
      });
      alertToast.success(
        variables.confirmSourceOverride
          ? "Alternate source picked — task reassigned and movement recorded"
          : variables.override
            ? "Pick confirmed with override — anomaly logged for review"
            : "Pick task confirmed",
        {
          className: "task-success-toast-rim",
        },
      );
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
      const shortfall = Number(result?.shortfall ?? 0);
      if (shortfall > 0) {
        setShortfallPrompt({ taskId: variables.taskId, quantity: shortfall });
        return;
      }
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
        alertToast.attention(
          `Only ${error.availableQuantity} available on this pallet (requested ${error.requestedQuantity}). Confirm the pallet and override to complete the pick for ${error.availableQuantity}.`,
          { duration: 8000 },
        );
        return;
      }
      alertToast.noGo(error instanceof Error ? error.message : "Pick confirmation failed");
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
      const { error } = await supabase.from("pick_lists").update({ status: "completed" }).eq("id", pickListId);
      if (error) throw error;
    },
    onSuccess: async () => {
      alertToast.success("Pick list complete — handed to dispatch");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pick-execution", pickListId] }),
        queryClient.invalidateQueries({ queryKey: ["pick-lists"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-search"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
      ]);
      navigate(toPath("/pick-lists"));
    },
    onError: (error) => alertToast.noGo(error instanceof Error ? error.message : "Could not mark complete"),
  });

  const shortfallMutation = useMutation({
    mutationFn: async ({ taskId, quantity }: { taskId: string; quantity: number }) =>
      createPickShortfallTask(taskId, quantity),
    onSuccess: async (result: any) => {
      setShortfallPrompt(null);
      if (result?.pallet_found) {
        alertToast.success(`Follow-up pick task ${result.task_number} created for the shortfall`);
      } else {
        alertToast.attention(
          `No available pallet found — ${result?.task_number ?? "the follow-up task"} was raised as an exception.`,
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pick-execution", pickListId] }),
        queryClient.invalidateQueries({ queryKey: ["pick-lists"] }),
      ]);
    },
    onError: (error) =>
      alertToast.noGo(error instanceof Error ? error.message : "Could not create the follow-up pick task"),
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
        </div>
        {!online ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="font-medium">This device is offline. Live pick confirmations are frozen.</p>
            <p className="mt-1 text-xs sm:text-sm">
              Your scan position stays on this device. Reconnect before you post the pick so the app can validate
              against live stock.
            </p>
          </div>
        ) : null}
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
            pickListCode={expectedPickListCode}
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
                Marking complete means pallets have been delivered to the dispatch/staging area and are handed off to
                the ERP.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
      <Dialog
        open={Boolean(shortfallPrompt)}
        onOpenChange={(open) => {
          if (!open) setShortfallPrompt(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Shortfall of {formatNumber(shortfallPrompt?.quantity ?? 0)}</DialogTitle>
            <DialogDescription>
              The pallet you picked was smaller than the requested quantity. Pick another pallet to make up the
              remaining {formatNumber(shortfallPrompt?.quantity ?? 0)}, or leave the line short as is.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={shortfallMutation.isPending} onClick={() => setShortfallPrompt(null)}>
              Leave as is
            </Button>
            <Button
              disabled={shortfallMutation.isPending}
              onClick={() => shortfallPrompt && shortfallMutation.mutate(shortfallPrompt)}
            >
              {shortfallMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Pick another pallet
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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

  const hasAssignedLocation = data.cells.some(
    (cell: { locationCode: string }) => cell.locationCode.toUpperCase() === assigned,
  );

  return (
    <div className="lg:col-span-4 grid gap-2 rounded-md border border-border bg-secondary/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Bay {data.aisle ?? "?"}-{data.bay ?? "?"}
        </span>
        <span>
          Pick from{" "}
          <span className="font-mono font-semibold text-foreground">{assignedLocationCode || "assigned location"}</span>
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
                    "min-h-16 rounded-md border px-2 py-2 text-left text-xs transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                    isAssigned
                      ? "animate-pulse border-yellow-300 bg-yellow-100 text-yellow-950 ring-2 ring-yellow-300 dark:border-yellow-500 dark:bg-yellow-950/50 dark:text-yellow-50"
                      : "cursor-not-allowed border-muted bg-muted text-muted-foreground opacity-70",
                  ].join(" ")}
                >
                  <span className="block font-mono font-semibold">{cell.locationCode}</span>
                  <span className="mt-1 block">
                    {cell.occupiedPallets}/{cell.maxPallets} pallets
                  </span>
                  <span className="block">
                    {isAssigned ? "Pallet location" : cell.status !== "active" ? cell.status : "Other bin"}
                  </span>
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
  pickListCode,
}: {
  task: any;
  onConfirm: (payload: {
    taskId: string;
    locationCode: string;
    palletBarcode: string;
    quantity: number;
    override?: boolean;
    confirmSourceOverride?: boolean;
    allowSourceQuantityVariance?: boolean;
    pickListCode: string;
  }) => void;
  isPending: boolean;
  confirmErrorNonce: number;
  anomaly?: { availableQuantity: number; requestedQuantity: number };
  onClearAnomaly?: () => void;
  registerLocationRef: (el: HTMLInputElement | null) => void;
  pickListCode: string;
}) {
  const form = useForm({
    defaultValues: {
      locationCode: "",
      palletBarcode: "",
      quantity: task.requested_quantity,
    },
  });
  const locationRef = useRef<HTMLInputElement | null>(null);
  const palletRef = useRef<HTMLInputElement | null>(null);
  const locationScanButtonRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [confirmPrompt, setConfirmPrompt] = useState(false);
  const [bayScan, setBayScan] = useState("");
  const [alternateMode, setAlternateMode] = useState(false);
  const [alternatePalletBarcode, setAlternatePalletBarcode] = useState("");
  const [alternatePreview, setAlternatePreview] = useState<Awaited<
    ReturnType<typeof previewPickSourceOverride>
  > | null>(null);
  const [alternateArmed, setAlternateArmed] = useState(false);
  const pallet = task.pallets as any;
  const product = pallet?.products as any;
  const location = task.locations ?? task.pick_balance?.locations ?? null;
  const locationCode = normalizeRackLocationCode(location?.code ?? "");
  const locationDescriptor = describePickLocation(location);
  const palletBarcode = pallet?.pallet_barcode ?? "";
  const palletQuantity =
    task.pick_balance?.available_quantity ?? pallet?.available_quantity ?? pallet?.quantity ?? task.requested_quantity;
  const wholePalletQuantity = Number(palletQuantity ?? task.requested_quantity ?? 0);
  const isOpen = PICK_OPEN_STATUSES.has(task.status);
  const scannedLocation = String(form.watch("locationCode") ?? "").trim();
  const scannedPallet = String(form.watch("palletBarcode") ?? "").trim();
  const scannedPalletError = palletBarcodeError(scannedPallet);
  const alternatePalletError = palletBarcodeError(alternatePalletBarcode);
  const readyToConfirm = Boolean(scannedLocation && scannedPallet && !scannedPalletError);
  const sourceOverrideScanned =
    readyToConfirm &&
    (normalizeRackLocationCode(scannedLocation) !== locationCode ||
      scannedPallet.toUpperCase() !== String(palletBarcode).toUpperCase());
  const lockForConfirm = confirmPrompt && readyToConfirm;
  const pickListId = String(task.pick_list_id ?? "");

  useEffect(() => {
    if (!isOpen) {
      clearPickTaskResumeSnapshot(task.id, pickListId);
      return;
    }
    const snapshot = loadPickTaskResumeSnapshot(task.id, pickListId);
    if (!snapshot) return;
    form.reset({
      locationCode: snapshot.locationCode ?? "",
      palletBarcode: snapshot.palletBarcode ?? "",
      quantity: task.requested_quantity,
    });
    setBayScan(snapshot.bayScan ?? "");
    setConfirmPrompt(Boolean(snapshot.confirmPrompt && snapshot.locationCode && snapshot.palletBarcode));
  }, [form, isOpen, pickListId, task.id, task.requested_quantity]);

  useEffect(() => {
    if (confirmErrorNonce > 0) setConfirmPrompt(false);
  }, [confirmErrorNonce]);

  useEffect(() => {
    if (!isOpen) {
      clearPickTaskResumeSnapshot(task.id, pickListId);
      return;
    }
    savePickTaskResumeSnapshot({
      taskId: task.id,
      pickListId,
      locationCode: scannedLocation,
      palletBarcode: scannedPallet,
      bayScan,
      confirmPrompt,
      updatedAt: Date.now(),
    });
  }, [bayScan, confirmPrompt, isOpen, pickListId, scannedLocation, scannedPallet, task.id]);

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
            {product?.sku ? `${product.sku} · ` : ""}
            {product?.name ?? "Product"} · {locationCode || "—"} · pallet {palletBarcode || "—"}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <span className="text-muted-foreground">Requested:</span> {formatNumber(task.requested_quantity)}
          </div>
          <div>
            <span className="text-muted-foreground">Confirmed:</span> {formatNumber(task.confirmed_quantity ?? 0)}
          </div>
          {task.short_reason ? (
            <div className="text-amber-600 sm:col-span-1">
              <span className="text-muted-foreground">Short:</span> {task.short_reason}
            </div>
          ) : (
            <div />
          )}
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
      alertToast.noGo("Scan the bay/location and pallet before confirming.");
      return;
    }
    if (sourceOverrideScanned) {
      alertToast.attention(
        "This pallet or location differs from the task. Use Pick a different pallet to verify and override it.",
      );
      return;
    }
    onConfirm({
      taskId: task.id,
      locationCode: values.locationCode,
      palletBarcode: values.palletBarcode,
      quantity: wholePalletQuantity,
      pickListCode,
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

  function previewAlternate(value: string) {
    const scanned = normalizePalletBarcode(value);
    if (!scanned) return;
    setAlternatePalletBarcode(scanned);
    setAlternatePreview(null);
    setAlternateArmed(false);
    const prefixError = palletBarcodeError(scanned);
    if (prefixError) {
      alertToast.noGo(prefixError);
      return;
    }

    void previewPickSourceOverride(task.id, pickListCode, scanned)
      .then((preview) => {
        if (!preview.source_override) {
          toast.info("This is the directed pallet. Scan it in the normal pick flow.");
          setAlternateMode(false);
          return;
        }
        setAlternatePreview(preview);
      })
      .catch((error) =>
        alertToast.noGo(error instanceof Error ? error.message : "Could not verify the alternate pallet."),
      );
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
            <form className="grid gap-4 lg:grid-cols-4" onSubmit={handleSubmit}>
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
                            className="w-20"
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
                          placeholder="Scan pallet barcode (PLT-…)"
                          onChange={(event) => {
                            onClearAnomaly?.();
                            field.onChange(normalizePalletBarcode(event.target.value));
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
                            form.setValue("palletBarcode", normalizePalletBarcode(value));
                            playBarcodeBeep();
                            flashInput(palletRef.current, "blue");
                            setConfirmPrompt(true);
                            setTimeout(() => {
                              flashInput(confirmRef.current, "yellow");
                              confirmRef.current?.focus();
                            }, 50);
                          }}
                          disabled={lockForConfirm}
                          className="w-20"
                        />
                      </div>
                    </FormControl>
                    {scannedPalletError ? <p className="text-xs text-destructive">{scannedPalletError}</p> : null}
                  </FormItem>
                )}
              />

              <div className="lg:col-span-2 grid gap-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Full pallet qty</span>
                <span className="font-mono text-base font-semibold">{formatNumber(wholePalletQuantity)}</span>
              </div>
              <div className="lg:col-span-4 rounded-md border border-dashed border-amber-400 bg-amber-50/60 p-3 dark:border-amber-600 dark:bg-amber-950/20">
                {!alternateMode ? (
                  <Button type="button" variant="outline" disabled={isPending} onClick={() => setAlternateMode(true)}>
                    Pick a different matching pallet
                  </Button>
                ) : (
                  <div className="grid gap-3">
                    <div>
                      <p className="font-medium text-amber-900 dark:text-amber-200">Verify an alternate pallet</p>
                      <p className="text-xs text-amber-800 dark:text-amber-300">
                        Scan the pallet. Its live location, SKU, quantity, assignment, and freeze status are checked
                        before an override can be armed.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={alternatePalletBarcode}
                        disabled={isPending}
                        placeholder="Scan alternate pallet barcode (PLT-…)"
                        onChange={(event) => setAlternatePalletBarcode(normalizePalletBarcode(event.target.value))}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            previewAlternate(event.currentTarget.value);
                          }
                        }}
                      />
                      <BarcodeScanButton
                        title="Scan alternate pallet barcode"
                        disabled={isPending}
                        onScan={previewAlternate}
                      />
                    </div>
                    {alternatePalletError ? <p className="text-xs text-destructive">{alternatePalletError}</p> : null}
                    {alternatePreview
                      ? (() => {
                          const scannedQty = Number(
                            alternatePreview.scanned_available_quantity ?? alternatePreview.requested_quantity,
                          );
                          const variance = Boolean(alternatePreview.quantity_variance);
                          const delta = scannedQty - Number(alternatePreview.requested_quantity ?? 0);
                          return (
                            <div className="grid gap-2 rounded-md border border-amber-400 bg-amber-100/70 p-3 text-sm text-amber-950 dark:border-amber-600 dark:bg-amber-950/50 dark:text-amber-100">
                              {variance ? (
                                <p>
                                  <AlertTriangle className="mr-1 inline h-4 w-4" />
                                  SKU <span className="font-mono font-semibold">{alternatePreview.sku}</span> matches,
                                  but this pallet holds{" "}
                                  <span className="font-mono font-semibold">{formatNumber(scannedQty)}</span> versus the
                                  requested{" "}
                                  <span className="font-mono font-semibold">
                                    {formatNumber(alternatePreview.requested_quantity)}
                                  </span>{" "}
                                  (
                                  {delta > 0 ? `${formatNumber(delta)} over` : `${formatNumber(Math.abs(delta))} short`}
                                  ). The whole pallet will be picked and the variance recorded on the task.
                                </p>
                              ) : (
                                <p>
                                  <CheckCircle2 className="mr-1 inline h-4 w-4" />
                                  SKU <span className="font-mono font-semibold">{alternatePreview.sku}</span> and
                                  full-pallet quantity{" "}
                                  <span className="font-mono font-semibold">{formatNumber(scannedQty)}</span> match this
                                  pick task.
                                </p>
                              )}
                              <p>
                                Directed: <span className="font-mono">{palletBarcode}</span> at{" "}
                                <span className="font-mono">{locationCode}</span>
                              </p>
                              <p>
                                Found: <span className="font-mono">{alternatePreview.scanned_pallet_barcode}</span> at{" "}
                                <span className="font-mono">{alternatePreview.scanned_location_code}</span>
                              </p>
                              {!alternateArmed ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="w-fit border-amber-500"
                                  onClick={() => setAlternateArmed(true)}
                                >
                                  {variance
                                    ? `Override & pick ${formatNumber(scannedQty)} (requested ${formatNumber(alternatePreview.requested_quantity)})`
                                    : "Override source"}
                                </Button>
                              ) : (
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium">
                                    The directed pallet will be released from this task. Its inventory stays available.
                                  </span>
                                  <Button
                                    type="button"
                                    disabled={isPending}
                                    onClick={() =>
                                      onConfirm({
                                        taskId: task.id,
                                        locationCode: alternatePreview.scanned_location_code,
                                        palletBarcode: alternatePreview.scanned_pallet_barcode,
                                        quantity: scannedQty,
                                        pickListCode,
                                        confirmSourceOverride: true,
                                        allowSourceQuantityVariance: variance,
                                      })
                                    }
                                  >
                                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                    Confirm pick
                                  </Button>
                                </div>
                              )}
                            </div>
                          );
                        })()
                      : null}
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-fit"
                      onClick={() => {
                        setAlternateMode(false);
                        setAlternatePreview(null);
                        setAlternateArmed(false);
                      }}
                    >
                      Cancel alternate pallet
                    </Button>
                  </div>
                )}
              </div>
              {anomaly ? (
                <div className="lg:col-span-4 flex flex-col gap-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-200">
                  <p>
                    <AlertTriangle className="mr-1 inline h-4 w-4" />
                    This pallet has already been debited — only{" "}
                    <span className="font-mono font-semibold">{formatNumber(anomaly.availableQuantity)}</span> is
                    available now (requested{" "}
                    <span className="font-mono font-semibold">{formatNumber(anomaly.requestedQuantity)}</span>).
                    Re-check the physical pallet, then override to complete the pick for the actual quantity. This will
                    log a record-count warning for admins and managers to review.
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
                        quantity: wholePalletQuantity,
                        override: true,
                        pickListCode,
                      })
                    }
                  >
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Override & confirm remaining {formatNumber(anomaly.availableQuantity)}
                  </Button>
                </div>
              ) : null}
              <Button
                ref={confirmRef}
                className={cn(
                  "w-full lg:col-span-4",
                  confirmPrompt &&
                    readyToConfirm &&
                    "animate-pulse border border-yellow-300 bg-yellow-300 text-yellow-950 hover:bg-yellow-300",
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

function HomeRedirect() {
  const { session } = useAuth();
  const { toPath } = useTenantPath();
  return <Navigate to={toPath(session ? "/dashboard" : "/login")} replace />;
}

function ProtectedLayout() {
  return (
    <ProtectedShell>
      <Outlet />
    </ProtectedShell>
  );
}

function FeatureFlagProvider({ children }: { children: ReactNode }) {
  const value = useFeatureFlagState();
  return <FeatureFlagContext.Provider value={value}>{children}</FeatureFlagContext.Provider>;
}

function TransfersDisabledPage() {
  return (
    <AppShell>
      <div className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-2xl font-semibold">Transfers are temporarily disabled</h1>
        <p className="text-sm text-muted-foreground">
          Inter-warehouse transfers are paused for all users while the workflow and reconnect behavior are being
          redesigned.
        </p>
      </div>
    </AppShell>
  );
}

function ResourceRoutes() {
  const resources = useMemo(
    () => ({
      clients: RESOURCE_DEFINITIONS.clients,
      warehouses: RESOURCE_DEFINITIONS.warehouses,
      zones: RESOURCE_DEFINITIONS.zones,
      locations: RESOURCE_DEFINITIONS.locations,
      products: RESOURCE_DEFINITIONS.products,
      packagingProfiles: RESOURCE_DEFINITIONS.packagingProfiles,
    }),
    [],
  );

  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/.lovable/oauth/consent" element={<OAuthConsentPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<ProtectedLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/clients" element={<ResourcePage resource={resources.clients as any} />} />
          <Route path="/warehouses" element={<ResourcePage resource={resources.warehouses as any} />} />
          <Route path="/zones" element={<ResourcePage resource={resources.zones as any} />} />
          <Route path="/locations" element={<ResourcePage resource={resources.locations as any} />} />
          <Route path="/products" element={<ResourcePage resource={resources.products as any} />} />
          <Route path="/packaging-profiles" element={<ResourcePage resource={resources.packagingProfiles as any} />} />
          <Route path="/receiving" element={<ReceivingPage />} />
          <Route path="/putaway-tasks" element={<PutawayTasksPage />} />
          <Route path="/inventory-search" element={<InventorySearchPage />} />
          <Route path="/pick-lists" element={<PickListsPage />} />
          <Route path="/transfers" element={<TransfersDisabledPage />} />
          <Route path="/location-moves" element={<LocationMovesPage />} />
          <Route path="/cycle-counts" element={<CycleCountsPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/users" element={<UsersRolesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/system-log" element={<SystemLogPage />} />
          <Route path="/email-log" element={<EmailLogPage />} />
          <Route path="/help" element={<HelpCenterPage />} />
          <Route path="/setup-wizard" element={<SetupWizardPage />} />
        </Route>
        <Route path="/inventory/:balanceId" element={<InventoryDetailPage />} />
        <Route path="/pick-lists/:pickListId" element={<PickExecutionPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function RuntimeModeBadge() {
  const hostname = typeof window === "undefined" ? "" : window.location.hostname.toLowerCase();
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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <FeatureFlagProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <RouteErrorBoundary>
              <Suspense fallback={<PageSpinner />}>
                <ResourceRoutes />
              </Suspense>
            </RouteErrorBoundary>
          </BrowserRouter>
          <RuntimeModeBadge />
          <ConnectionRecovery />
          <WhatsNewOnUpdate release={RELEASE_HISTORY[0]} />
          <AiHintFailureAlert />
          <Analytics />
        </FeatureFlagProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
