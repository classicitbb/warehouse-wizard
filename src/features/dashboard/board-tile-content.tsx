// Command Center tile contents. Each renders at its natural height; the board
// measures it and grows the tile to fit (see dashboard-board.tsx).

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Bot, ClipboardCheck, Gauge, Hourglass, ListTodo, PackageCheck, RadioTower, ShieldAlert, Truck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatNumber, type DashboardMetrics } from "@/features/shared/core-types";
import { useTenantPath } from "@/hooks/use-tenant-path";
import type { ModuleKey } from "@/hooks/use-feature-flags";
import type { DockHandoffLoad, EnterpriseDashboardSnapshot } from "@/lib/enterprise-wms";
import { cn } from "@/lib/utils";

export type Tone = "success" | "warning" | "critical" | "info";

export type BoardData = {
  snapshot: EnterpriseDashboardSnapshot;
  metrics: DashboardMetrics | undefined;
  isLoading: boolean;
  isEnabled: (key: ModuleKey) => boolean;
};

const TASK_ROWS = 5;
const LANE_LOADS = 4;

// ── Building blocks ──────────────────────────────────────────────────────────

function useTo() {
  return useTenantPath().toPath;
}

function TileTitle({ icon, title, value, href }: { icon: ReactNode; title: string; value?: ReactNode; href?: string }) {
  const to = useTo();
  return (
    <div className="flex items-start justify-between gap-3">
      <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold leading-5 text-muted-foreground [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0">
        {icon}
        <span className="break-words">{title}</span>
      </h3>
      {value !== undefined ? (
        href ? (
          <Link to={to(href)} className="shrink-0 rounded-sm text-3xl font-bold leading-none tabular-nums transition hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {value}
          </Link>
        ) : (
          <span className="shrink-0 text-3xl font-bold leading-none tabular-nums">{value}</span>
        )
      ) : null}
    </div>
  );
}

/** A label/number row that links to where the number comes from. */
function MetricRow({ label, value, href, emphasis }: { label: string; value: number; href: string; emphasis?: Tone }) {
  const to = useTo();
  return (
    <Link
      to={to(href)}
      className="flex items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-sm transition hover:bg-secondary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="min-w-0 break-words text-muted-foreground">{label}</span>
      <span
        className={cn(
          "shrink-0 text-lg font-semibold tabular-nums",
          value > 0 && emphasis === "critical" && "text-destructive",
          value > 0 && emphasis === "warning" && "text-warning",
        )}
      >
        {formatNumber(value)}
      </span>
    </Link>
  );
}

function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  const to = useTo();
  return (
    <Link to={to(href)} className="inline-flex items-center gap-1 self-start rounded-sm text-sm font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {children} <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );
}

function Loading({ data, children }: { data: BoardData; children: ReactNode }) {
  if (data.isLoading && !data.metrics) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return <>{children}</>;
}

// ── Tiles ────────────────────────────────────────────────────────────────────

export function CapacityTile({ data }: { data: BoardData }) {
  const m = data.metrics;
  const used = m?.warehousePallets ?? 0;
  const capacity = m?.warehousePalletCapacity ?? 0;
  const percent = capacity > 0 ? Math.min(100, Math.round((used / capacity) * 100)) : 0;
  const to = useTo();
  return (
    <div className="grid gap-3">
      <TileTitle icon={<Gauge />} title="Storage capacity" />
      <Loading data={data}>
        <div className="flex flex-wrap items-center gap-4">
          <Link
            to={to("/inventory-search")}
            aria-label={`This warehouse ${percent}% full`}
            className="grid h-20 w-20 shrink-0 place-items-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ background: `conic-gradient(hsl(var(--primary)) ${percent}%, hsl(var(--accent) / 0.35) ${percent}% 100%)` }}
          >
            <span className="grid h-14 w-14 place-items-center rounded-full bg-card text-sm font-semibold tabular-nums">{percent}%</span>
          </Link>
          <div className="min-w-0">
            <p className="text-3xl font-bold leading-none tabular-nums">{formatNumber(used)}</p>
            <p className="mt-1 text-xs text-muted-foreground">pallets here · {formatNumber(capacity)} locations</p>
          </div>
        </div>
        <div className="grid">
          <MetricRow label="All warehouses" value={m?.totalPallets ?? 0} href="/inventory-search" />
          <MetricRow label="Available to pick" value={m?.availablePallets ?? 0} href="/inventory-search" />
        </div>
      </Loading>
    </div>
  );
}

export function OpenWorkTile({ data }: { data: BoardData }) {
  const m = data.metrics;
  const rows: Array<[ModuleKey, string, number, string]> = [
    ["receiving", "Receipts", m?.openReceipts ?? 0, "/receiving"],
    ["putaway", "Put-away", m?.openPutawayTasks ?? 0, "/putaway-tasks"],
    ["pick-lists", "Pick lists", m?.openPickLists ?? 0, "/pick-lists"],
    ["location-moves", "Moves", m?.openMoveTasks ?? 0, "/location-moves"],
    ["cycle-counts", "Counts", m?.openCycleCounts ?? 0, "/cycle-counts"],
  ];
  return (
    <div className="grid gap-2">
      <TileTitle icon={<ListTodo />} title="Open work" />
      <Loading data={data}>
        <div className="grid">
          {rows.filter(([key]) => data.isEnabled(key)).map(([, label, value, href]) => (
            <MetricRow key={label} label={label} value={value} href={href} />
          ))}
        </div>
      </Loading>
    </div>
  );
}

export function StockStatusTile({ data }: { data: BoardData }) {
  const m = data.metrics;
  return (
    <div className="grid gap-2">
      <TileTitle icon={<ShieldAlert />} title="Hold & quarantine" />
      <Loading data={data}>
        <div className="grid">
          <MetricRow label="On hold" value={m?.holdStock ?? 0} href="/status" emphasis="warning" />
          <MetricRow label="Quarantine" value={m?.quarantineStock ?? 0} href="/status" emphasis="critical" />
        </div>
      </Loading>
    </div>
  );
}

export function StockHealthTile({ data }: { data: BoardData }) {
  const m = data.metrics;
  return (
    <div className="grid gap-2">
      <TileTitle icon={<Hourglass />} title="Expiry & aging" />
      <Loading data={data}>
        <div className="grid">
          <MetricRow label="Expires ≤ 30 days" value={m?.expiryWarning30 ?? 0} href="/inventory-search?expiry=30d" emphasis="critical" />
          <MetricRow label="Expires ≤ 60 days" value={m?.expiryWarning60 ?? 0} href="/inventory-search?expiry=60d" emphasis="warning" />
          <MetricRow label="Aging 3+ months" value={m?.stockAge3Months ?? 0} href="/inventory-search?age=3m" />
          <MetricRow label="Aging 6+ months" value={m?.stockAge6Months ?? 0} href="/inventory-search?age=6m" />
          <MetricRow label="Aging 12+ months" value={m?.stockAge12Months ?? 0} href="/inventory-search?age=12m" emphasis="warning" />
        </div>
      </Loading>
    </div>
  );
}

export function QueueTile({ data, label }: { data: BoardData; label: string }) {
  const queue = data.snapshot.floorQueues.find((item) => item.label === label);
  const to = useTo();
  if (!queue) return null;
  const more = queue.count - queue.tasks.length;
  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <TileTitle icon={<PackageCheck />} title={queue.label} value={formatNumber(queue.count)} href={queue.route} />
        <p className="text-xs text-muted-foreground">{queue.action}</p>
      </div>
      {queue.tasks.length > 0 ? (
        <ul className="grid gap-1">
          {queue.tasks.slice(0, TASK_ROWS).map((task) => (
            <li key={task.id}>
              <Link
                to={to(task.route)}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-md border border-border bg-secondary/30 px-3 py-1.5 text-sm transition-colors hover:bg-secondary/60"
              >
                <span className="min-w-0 break-words font-medium leading-tight">{task.label}</span>
                <Badge variant="outline" className="shrink-0 whitespace-nowrap text-xs capitalize">{task.sublabel}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing waiting.</p>
      )}
      <MoreLink href={queue.route}>{more > 0 ? `${formatNumber(more)} more — open workflow` : "Open workflow"}</MoreLink>
    </div>
  );
}

export function IntelligenceTile({ data }: { data: BoardData }) {
  const to = useTo();
  return (
    <div className="grid gap-2">
      <TileTitle icon={<RadioTower />} title="Warehouse intelligence" />
      <div className="grid gap-1.5">
        {data.snapshot.leanMetrics.map((metric) => (
          <Link
            key={metric.label}
            to={to(metric.route)}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-md border border-border px-3 py-2 transition hover:bg-secondary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="min-w-0">
              <span className="block break-words text-sm font-medium leading-5">{metric.label}</span>
              <span className="block break-words text-xs text-muted-foreground">Target: {metric.target}</span>
            </span>
            <span className="flex flex-col items-end gap-1 text-right">
              <span className="text-base font-semibold leading-none tabular-nums">{metric.value}</span>
              <Badge className="px-1.5 py-0 text-[10px]" variant={metric.status === "off_target" ? "destructive" : metric.status === "watch" ? "secondary" : "default"}>
                {metric.status.replace("_", " ")}
              </Badge>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function DockLaneTile({ data, status }: { data: BoardData; status: DockHandoffLoad["status"] }) {
  const loads = data.snapshot.dockLoads.filter((load) => load.status === status);
  const shown = loads.slice(0, LANE_LOADS);
  return (
    <div className="grid gap-3">
      <TileTitle icon={status === "blocked" ? <AlertTriangle /> : <Truck />} title={status[0].toUpperCase() + status.slice(1)} value={formatNumber(loads.length)} href="/pick-lists" />
      {shown.length === 0 ? <p className="text-sm text-muted-foreground">No loads.</p> : null}
      {shown.map((load) => (
        <div key={load.id} className="grid gap-0.5 rounded-md border border-border bg-secondary/30 p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="break-words font-semibold">{load.route}</span>
            <Badge>{load.door}</Badge>
          </div>
          <p className="break-words text-sm">{load.customer}</p>
          <p className="break-words text-xs text-muted-foreground">{load.driver} · {load.pallets} pallet{load.pallets === 1 ? "" : "s"} · {load.temperatureClass}</p>
          {load.blocker ? <p className="break-words text-xs text-destructive">{load.blocker}</p> : null}
        </div>
      ))}
      {loads.length > shown.length ? <MoreLink href="/pick-lists">{loads.length - shown.length} more</MoreLink> : null}
    </div>
  );
}

export function BrainTile({ data }: { data: BoardData }) {
  const to = useTo();
  return (
    <div className="grid gap-2">
      <TileTitle icon={<Bot />} title="Warehouse Brain" />
      {data.snapshot.recommendations.map((item) => (
        <Link
          key={item.id}
          to={to(item.route)}
          className={cn(
            "grid gap-1 rounded-md border border-border p-2.5 transition hover:bg-secondary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            item.severity === "critical" ? "bg-destructive/10" : item.severity === "warning" ? "bg-warning/10" : "bg-secondary/30",
          )}
        >
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="break-words text-sm font-medium">{item.title}</span>
            <Badge variant={item.severity === "critical" ? "destructive" : "secondary"}>{item.severity}</Badge>
          </span>
          <span className="break-words text-xs text-muted-foreground">{item.reason}</span>
          <span className="break-words text-xs">{item.nextAction}</span>
        </Link>
      ))}
    </div>
  );
}

export function OfficeWidgetTile({ data, label, title }: { data: BoardData; label: string; title: string }) {
  const widget = data.snapshot.officeWidgets.find((item) => item.label === label);
  if (!widget) return null;
  return (
    <div className="grid gap-1">
      <TileTitle icon={<Gauge />} title={title} value={widget.value} href={widget.route} />
      <p className="break-words text-xs text-muted-foreground">{widget.detail}</p>
    </div>
  );
}

export function SetupChecklistTile({ data }: { data: BoardData }) {
  const open = data.snapshot.setupChecklist.filter((item) => !item.complete).length;
  return (
    <div className="grid gap-2">
      <TileTitle icon={<ClipboardCheck />} title="Setup checklist" value={`${open} open`} />
      <div className="grid gap-1">
        {data.snapshot.setupChecklist.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3 rounded-md border border-border px-2.5 py-1.5">
            <span className="min-w-0">
              <span className="block break-words text-sm">{item.label}</span>
              <span className="block text-xs text-muted-foreground">{item.owner}</span>
            </span>
            <Badge variant={item.complete ? "default" : "secondary"}>{item.complete ? "Ready" : "Open"}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
