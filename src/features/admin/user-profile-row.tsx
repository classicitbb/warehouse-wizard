// One editable user row on the Users & Roles page, plus badge printing.
import { useEffect, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, CircleOff, Loader2, LogOut, Pencil, Power, Printer } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { updateProfileDetails } from "@/lib/wms-core";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import { WarehouseOption, ProfileRow } from "@/features/shared/ui-shared";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isWeakBadgePin(pin: string) {
  const easyPins = new Set([
    "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999",
    "1234", "12345", "123456", "1234567", "4321", "54321", "654321", "7654321",
    "2580", "0852", "1212", "1122", "6969", "1010", "2020", "1230", "7890",
  ]);
  if (!/^\d{4,7}$/.test(pin)) return true;
  if (/^(\d)\1+$/.test(pin)) return true;
  if (easyPins.has(pin)) return true;
  if ("0123456789".includes(pin) || "9876543210".includes(pin)) return true;
  return false;
}

function printUserBadge({
  badgeCode,
  fullName,
  phone,
  roles,
}: {
  badgeCode: string;
  fullName: string;
  phone: string;
  roles: string[];
}) {
  const qrSvg = renderToStaticMarkup(
    <QRCodeSVG value={badgeCode} size={210} bgColor="#ffffff" fgColor="#000000" level="M" />,
  );
  const roleText = roles.length > 0 ? roles.join(", ") : "No assigned role";
  const printWindow = window.open("", "_blank", "width=420,height=360");
  if (!printWindow) {
    toast.error("Popup blocked. Allow popups to print the badge.");
    return;
  }

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(fullName || "User badge")}</title>
        <style>
          @page { size: 3in 2.5in; margin: 0; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            width: 3in;
            height: 2.5in;
            font-family: Arial, sans-serif;
            color: #102033;
            background: #ffffff;
          }
          .badge {
            width: 3in;
            height: 2.5in;
            display: grid;
            grid-template-columns: 1fr 0.95in;
            gap: 0.12in;
            padding: 0.18in;
            border: 1px solid #102033;
          }
          .brand {
            font-size: 8pt;
            font-weight: 700;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            color: #0f766e;
          }
          .name {
            margin-top: 0.18in;
            font-size: 17pt;
            line-height: 1.05;
            font-weight: 800;
          }
          .meta {
            margin-top: 0.08in;
            font-size: 8.5pt;
            line-height: 1.25;
          }
          .qr {
            align-self: center;
            justify-self: center;
            width: 0.95in;
            height: 0.95in;
          }
          .code {
            grid-column: 1 / -1;
            align-self: end;
            font-family: "Courier New", monospace;
            font-size: 8pt;
            letter-spacing: 0.08em;
            color: #334155;
          }
          svg { width: 100%; height: 100%; display: block; }
        </style>
      </head>
      <body>
        <main class="badge">
          <section>
            <div class="brand">Warehouse Wizard</div>
            <div class="name">${escapeHtml(fullName || "Warehouse User")}</div>
            <div class="meta">
              <strong>Phone</strong><br>${escapeHtml(phone || "Not set")}<br><br>
              <strong>Role</strong><br>${escapeHtml(roleText)}
            </div>
          </section>
          <section class="qr">${qrSvg}</section>
          <div class="code">${escapeHtml(badgeCode)}</div>
        </main>
        <script>
          window.onload = function () {
            window.focus();
            window.print();
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

export function UserProfileRow({
  profile,
  warehouses,
  userRoles,
  onSave,
  onToggleActive,
  onSignOutAllSessions,
  revokingSessions,
}: {
  profile: ProfileRow;
  warehouses: WarehouseOption[];
  userRoles: any[];
  onSave: (
    values: Parameters<typeof updateProfileDetails>[0],
    credentials?: { newPassword?: string; badgePin?: string },
  ) => void;
  onToggleActive: () => void;
  onSignOutAllSessions: () => void;
  revokingSessions: boolean;
}) {
  const { profile: viewerProfile, roles: viewerRoles } = useAuth();
  const targetIsDeveloper = userRoles.some((ur: any) => (ur.roles as { code?: string } | null)?.code === "developer");
  const canChangePassword = viewerRoles.includes("developer") || !targetIsDeveloper;
  const isSelf = viewerProfile?.id === profile.id;
  const canRevokeSessions = viewerRoles.some((role) => ["developer", "admin"].includes(role));

  const [open, setOpen] = useState(false);
  const fallbackWarehouseId = !profile.default_warehouse_id && warehouses.length === 1 ? warehouses[0]?.id ?? "" : "";
  const [values, setValues] = useState({
    full_name: profile.full_name ?? "",
    phone: profile.phone ?? "",
    default_warehouse_id: profile.default_warehouse_id ?? fallbackWarehouseId,
    active: profile.active ?? true,
    approved: profile.approved ?? false,
    user_code: profile.user_code ?? "",
    badge_code: profile.badge_code ?? "",
  });
  const [newPassword, setNewPassword] = useState("");
  const [badgePin, setBadgePin] = useState("");

  useEffect(() => {
    if (!profile.default_warehouse_id && warehouses.length === 1 && !values.default_warehouse_id) {
      setValues((current) => ({ ...current, default_warehouse_id: warehouses[0]?.id ?? "" }));
    }
  }, [profile.default_warehouse_id, values.default_warehouse_id, warehouses]);

  const roleNames = userRoles
    .filter((ur) => !ur.is_hidden)
    .map((ur) => (ur.roles as { name?: string } | null)?.name ?? "")
    .filter(Boolean);
  const hasBadgeCode = values.badge_code.trim().length > 0;

  const handlePrintBadge = () => {
    if (!hasBadgeCode) return;
    printUserBadge({
      badgeCode: values.badge_code.trim(),
      fullName: values.full_name.trim(),
      phone: values.phone.trim(),
      roles: roleNames,
    });
  };

  const handleSave = () => {
    const trimmedPassword = newPassword.trim();
    const trimmedBadgePin = badgePin.trim();
    if (trimmedPassword && trimmedBadgePin) {
      toast.error("Set either a new password or a badge PIN, not both.");
      return;
    }
    if (trimmedPassword && trimmedPassword.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (trimmedBadgePin && isWeakBadgePin(trimmedBadgePin)) {
      toast.error("Badge PIN must be 4-7 digits and not an easy sequence or repeated code.");
      return;
    }
    onSave(
      { profileId: profile.id, ...values, active: isSelf ? true : values.active },
      {
        newPassword: trimmedPassword || undefined,
        badgePin: trimmedBadgePin || undefined,
      },
    );
    setOpen(false);
  };

  return (
    <TableRow
      className={cn("h-10 cursor-pointer even:bg-muted/30", !profile.active && "opacity-60")}
      onDoubleClick={() => setOpen(true)}
    >
      <TableCell className="max-w-48 p-2">
        <p className="truncate text-sm font-medium">{profile.full_name ?? profile.email ?? profile.id}</p>
      </TableCell>
      <TableCell className="max-w-56 p-2 text-sm text-muted-foreground">
        <span className="block truncate">{profile.email ?? "—"}</span>
      </TableCell>
      <TableCell className="max-w-64 p-2">
        <div className="flex flex-wrap items-center gap-1">
          {roleNames.length > 0 ? roleNames.map((name) => (
            <Badge key={name} variant="outline" className="px-1.5 py-0 text-xs">{name}</Badge>
          )) : <span className="text-sm text-muted-foreground">No roles</span>}
        </div>
      </TableCell>
      <TableCell className="p-2 text-center">
        {profile.active ? (
          <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-600" aria-label="Enabled" />
        ) : (
          <CircleOff className="mx-auto h-4 w-4 text-muted-foreground" aria-label="Disabled" />
        )}
      </TableCell>
      <TableCell className="p-2 text-center">
        {profile.approved ? (
          <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-600" aria-label="Approved" />
        ) : (
          <CircleOff className="mx-auto h-4 w-4 text-muted-foreground" aria-label="Pending approval" />
        )}
      </TableCell>
      <TableCell className="p-1 text-center">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label={`Edit ${profile.full_name ?? profile.email ?? "user"}`}
              title="Edit user"
              onClick={(event) => event.stopPropagation()}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Edit User</DialogTitle>
                <DialogDescription>Update operational access, codes, and approval status.</DialogDescription>
              </DialogHeader>
              <div className="max-h-[70vh] overflow-y-auto pr-4">
                <div className="grid gap-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <label className="text-sm font-medium">Full name</label>
                      <Input value={values.full_name} onChange={(e) => setValues((v) => ({ ...v, full_name: e.target.value }))} />
                    </div>
                    <div className="grid gap-1.5">
                      <label className="text-sm font-medium">Phone</label>
                      <Input value={values.phone} onChange={(e) => setValues((v) => ({ ...v, phone: e.target.value }))} />
                    </div>
                    <div className="grid gap-1.5">
                      <label className="text-sm font-medium">User code</label>
                      <Input value={values.user_code} placeholder="e.g. OPR02" onChange={(e) => setValues((v) => ({ ...v, user_code: e.target.value }))} />
                    </div>
                    <div className="grid gap-1.5">
                      <label className="text-sm font-medium">Badge code</label>
                      <Input value={values.badge_code} placeholder="e.g. BADGE-OPR02" onChange={(e) => setValues((v) => ({ ...v, badge_code: e.target.value }))} />
                    </div>
                    {canChangePassword && (
                      <div className="grid gap-1.5 sm:col-span-2">
                        <label className="text-sm font-medium">Badge sign-in PIN</label>
                        <Input
                          value={badgePin}
                          inputMode="numeric"
                          maxLength={7}
                          placeholder="Leave blank to keep current PIN"
                          onChange={(e) => setBadgePin(e.target.value.replace(/\D/g, "").slice(0, 7))}
                        />
                        <p className="text-xs text-muted-foreground">Use 4-7 digits. Repeated or sequential codes are blocked.</p>
                      </div>
                    )}
                    <div className="grid gap-1.5 sm:col-span-2">
                      <label className="text-sm font-medium">Default warehouse</label>
                      <Select
                        value={values.default_warehouse_id || "none"}
                        onValueChange={(val) => setValues((v) => ({ ...v, default_warehouse_id: val === "none" ? "" : val }))}
                      >
                        <SelectTrigger><SelectValue placeholder="No default" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No default warehouse</SelectItem>
                          {warehouses.map((wh) => <SelectItem key={wh.id} value={wh.id}>{wh.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className={cn(
                      "flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm",
                      isSelf ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-accent",
                    )}>
                      <Checkbox
                        checked={values.active}
                        disabled={isSelf}
                        onCheckedChange={(c) => {
                          if (!isSelf) setValues((v) => ({ ...v, active: Boolean(c) }));
                        }}
                      />
                      <div>
                        <p className="font-medium">Active</p>
                        <p className="text-xs text-muted-foreground">{isSelf ? "You cannot disable your own account" : "Can sign in"}</p>
                      </div>
                    </label>
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-accent">
                      <Checkbox
                        checked={values.approved}
                        onCheckedChange={(c) => setValues((v) => ({ ...v, approved: Boolean(c) }))}
                      />
                      <div>
                        <p className="font-medium">Approved</p>
                        <p className="text-xs text-muted-foreground">Admin confirmed</p>
                      </div>
                    </label>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {canChangePassword ? (
                      <div className="grid gap-1.5">
                        <label className="text-sm font-medium">New password</label>
                        <Input
                          type="password"
                          value={newPassword}
                          placeholder="Leave blank to keep current"
                          onChange={(e) => setNewPassword(e.target.value)}
                        />
                      </div>
                    ) : (
                      <p className="self-center text-xs text-muted-foreground">Password changes for developer accounts are restricted.</p>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      className="self-end"
                      disabled={!hasBadgeCode}
                      title={hasBadgeCode ? "Print badge" : "Enter a badge code before printing"}
                      onClick={handlePrintBadge}
                    >
                      <Printer className="mr-2 h-4 w-4" />
                      Print badge
                    </Button>
                  </div>
                  {canRevokeSessions && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" variant="outline" className="border-destructive/50 text-destructive hover:bg-destructive/10">
                          <LogOut className="mr-2 h-4 w-4" />
                          Sign out of all sessions
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Sign out {profile.full_name ?? profile.email ?? "this user"} everywhere?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This removes every active refresh session for this account. Existing access tokens expire shortly and the user must sign in again.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            disabled={revokingSessions}
                            onClick={onSignOutAllSessions}
                          >
                            {revokingSessions ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Sign out all sessions
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                  <Button
                    className="w-full"
                    onClick={handleSave}
                  >
                    Save changes
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
      </TableCell>
      <TableCell className="p-1 text-center">
        <Button
          size="icon"
          variant="ghost"
          className={cn("h-7 w-7", profile.active && !isSelf && "text-destructive hover:text-destructive")}
          disabled={isSelf}
          aria-label={profile.active ? `Disable ${profile.full_name ?? profile.email ?? "user"}` : `Enable ${profile.full_name ?? profile.email ?? "user"}`}
          title={isSelf ? "You cannot disable your own account" : profile.active ? "Disable user" : "Enable user"}
          onClick={(event) => {
            event.stopPropagation();
            onToggleActive();
          }}
        >
          <Power className="h-3.5 w-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
