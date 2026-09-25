// Banners, reminders and account dialogs the app shell shows around every page.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertCircle,
  Bell,
  KeyRound,
  Loader2,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useTenantPath } from "@/hooks/use-tenant-path";
import { type FailedWorkItem, useDeadLetterQueue } from "@/lib/offline-queue";
import { useNotificationPermission } from "@/hooks/use-notification-permission";
import { updateOwnPassword } from "@/lib/wms-core";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function ChangeOwnPasswordDialog({
  onClose,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: {
  onClose?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const setOpen = (value: boolean) => {
    if (!isControlled) setInternalOpen(value);
    onOpenChange?.(value);
  };
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const mutation = useMutation({
    mutationFn: () => updateOwnPassword(password),
    onSuccess: () => {
      toast.success("Password updated");
      setPassword("");
      setConfirm("");
      setOpen(false);
      onClose?.();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Password update failed"),
  });

  const handleSubmit = () => {
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match.");
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 w-7 shrink-0 p-0" aria-label="Change password">
            <KeyRound className="h-3 w-3" />
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Enter a new password for your account. Minimum 8 characters.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">New password</label>
            <Input
              type="password"
              value={password}
              placeholder="At least 8 characters"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">Confirm password</label>
            <Input
              type="password"
              value={confirm}
              placeholder="Repeat new password"
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="animate-spin" /> : null}
            Update password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FailedTasksReminder() {
  const { items, dismiss, dismissAll } = useDeadLetterQueue();
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [items.length]);

  if (items.length === 0) return null;

  const item = items[Math.min(activeIndex, items.length - 1)];
  if (!item) return null;

  function describeItem(it: FailedWorkItem) {
    if (it.kind === "putaway") {
      const p = it.payload as { pallet: string; location: string; taskNumber?: string };
      return `Putaway${p.taskNumber ? ` #${p.taskNumber}` : ""} — pallet ${p.pallet} → ${p.location}`;
    }
    if (it.kind === "pick") {
      const p = it.payload as { palletBarcode: string; locationCode: string };
      return `Pick — pallet ${p.palletBarcode} at ${p.locationCode}`;
    }
    return it.kind;
  }

  const timestamp = new Date(item.failedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <Dialog open>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5 shrink-0" />
            {items.length === 1 ? "Offline task needs attention" : `${items.length} offline tasks need attention`}
          </DialogTitle>
          <DialogDescription>
            {items.length > 1
              ? `One or more actions saved while offline could not be submitted when you reconnected. Review each one and confirm whether the work is done.`
              : `An action saved while offline could not be submitted when you reconnected. Confirm whether the work is done.`}
          </DialogDescription>
        </DialogHeader>

        {items.length > 1 && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Item {activeIndex + 1} of {items.length}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={activeIndex === 0} onClick={() => setActiveIndex((i) => i - 1)}>←</Button>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={activeIndex >= items.length - 1} onClick={() => setActiveIndex((i) => i + 1)}>→</Button>
            </div>
          </div>
        )}

        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm space-y-1.5">
          <p className="font-medium">{describeItem(item)}</p>
          <p className="text-xs text-muted-foreground">Failed at {timestamp} · {item.attempts} attempt{item.attempts === 1 ? "" : "s"}</p>
          <p className="text-xs text-destructive/80 break-words">{item.error}</p>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {items.length > 1 && (
            <Button
              variant="ghost"
              className="text-muted-foreground sm:mr-auto"
              onClick={() => void dismissAll()}
            >
              Mark all resolved
            </Button>
          )}
          <Button variant="outline" onClick={() => void dismiss(item.id)}>
            Mark resolved
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AccessRequestsBanner() {
  const { roles } = useAuth();
  const navigate = useNavigate();
  const { toPath } = useTenantPath();
  const canSee = roles.some((r) => ["admin", "warehouse_manager", "warehouse_supervisor", "developer"].includes(r));
  const [dismissed, setDismissed] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(window.sessionStorage.getItem("dismissed-pending-requests") ?? "[]");
    } catch {
      return [];
    }
  });

  const { data: pending = [] } = useQuery({
    queryKey: ["pending-access-requests"],
    enabled: canSee,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, created_at")
        .eq("approved", false)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null; created_at: string | null }>;
    },
  });

  const undismissed = useMemo(
    () => pending.filter((p) => !dismissed.includes(p.id)),
    [pending, dismissed],
  );
  const open = canSee && undismissed.length > 0;

  function dismissAll() {
    const next = Array.from(new Set([...dismissed, ...undismissed.map((p) => p.id)]));
    setDismissed(next);
    try {
      window.sessionStorage.setItem("dismissed-pending-requests", JSON.stringify(next));
    } catch {
      /* noop */
    }
  }

  function goToUsers() {
    dismissAll();
    navigate(toPath("/settings"));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismissAll(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <UserPlus className="h-5 w-5" />
            {undismissed.length} access request{undismissed.length === 1 ? "" : "s"} awaiting approval
          </DialogTitle>
          <DialogDescription>
            New users have requested access to the warehouse. Review and approve them in Users &amp; Roles.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded border border-border">
          {undismissed.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{p.full_name?.trim() || p.email || "Unnamed user"}</div>
                {p.email && p.full_name ? (
                  <div className="truncate text-xs text-muted-foreground">{p.email}</div>
                ) : null}
              </div>
              <div className="shrink-0 text-xs text-muted-foreground">
                {p.created_at ? new Date(p.created_at).toLocaleDateString() : ""}
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={dismissAll}>Remind me later</Button>
          <Button onClick={goToUsers}>
            <Users className="mr-2 h-4 w-4" />
            Go to Users
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const NOTIFICATION_PROMPT_DISMISSED_SESSION_KEY = "warehouseWizard.notificationPrompt.dismissed";

/**
 * Soft, dismissible ask for browser notification permission — this is the
 * first of the two prompts. Clicking "Enable notifications" triggers the
 * real native browser permission popup (the second, unskippable prompt).
 * Browsers only allow that native popup to fire from a genuine user
 * gesture, so we can't skip straight to it; the banner is what gives the
 * click its context. Dismissing only suppresses it for the current session
 * (sessionStorage) — if the user still hasn't decided, it reappears next
 * session rather than nagging on every page within one.
 */
export function ReorderAlertNotificationPrompt() {
  const { supported, permission, requestPermission } = useNotificationPermission();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(NOTIFICATION_PROMPT_DISMISSED_SESSION_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [requesting, setRequesting] = useState(false);

  function dismiss() {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(NOTIFICATION_PROMPT_DISMISSED_SESSION_KEY, "1");
    } catch {
      // ignore storage failures — worst case the banner reappears
    }
  }

  async function handleEnable() {
    setRequesting(true);
    try {
      const result = await requestPermission();
      if (result === "granted") {
        toast.success("Notifications enabled — you'll get an alert when a product enters the reorder state.");
      } else if (result === "denied") {
        toast.message("Notifications blocked. You can turn them back on from your browser's site settings.");
      }
    } finally {
      setRequesting(false);
      dismiss();
    }
  }

  if (!supported || permission !== "default" || dismissed) return null;

  return (
    <div className="fixed bottom-20 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] lg:landscape:bottom-4">
      <Card className="border-primary/40 shadow-lg">
        <CardContent className="flex items-start gap-3 p-3.5">
          <Bell className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Get notified about reorder alerts</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Turn on browser notifications to hear about low-stock products as soon as they enter the reorder state.
            </p>
            <div className="mt-2.5 flex gap-2">
              <Button size="sm" disabled={requesting} onClick={() => void handleEnable()}>
                {requesting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Enable notifications
              </Button>
              <Button size="sm" variant="ghost" onClick={dismiss}>Not now</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
