import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, useNavigation, type CaptionProps } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

type View = "days" | "months" | "years";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const YEARS_PER_PAGE = 12;

const navButtonClass = cn(buttonVariants({ variant: "outline" }), "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100");
const headerButtonClass = "rounded-md px-2 py-1 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Lets the stable Caption component below talk to the Calendar that owns the view.
const ViewContext = React.createContext<{ openView: (view: View) => void }>({ openView: () => {} });

function CalendarCaption({ displayMonth }: CaptionProps) {
  const { goToMonth, previousMonth, nextMonth } = useNavigation();
  const { openView } = React.useContext(ViewContext);
  return (
    <div className="relative flex items-center justify-center pt-1">
      <button type="button" className={cn(navButtonClass, "absolute left-1")} disabled={!previousMonth} onClick={() => previousMonth && goToMonth(previousMonth)} aria-label="Previous month">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="flex items-center gap-1">
        <button type="button" className={headerButtonClass} onClick={() => openView("months")} aria-label="Choose month">
          {displayMonth.toLocaleString("en-US", { month: "long" })}
        </button>
        <button type="button" className={headerButtonClass} onClick={() => openView("years")} aria-label="Choose year">
          {displayMonth.getFullYear()}
        </button>
      </div>
      <button type="button" className={cn(navButtonClass, "absolute right-1")} disabled={!nextMonth} onClick={() => nextMonth && goToMonth(nextMonth)} aria-label="Next month">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function PickerGrid({
  title,
  onTitleClick,
  onPrev,
  onNext,
  items,
}: {
  title: string;
  onTitleClick?: () => void;
  onPrev: () => void;
  onNext: () => void;
  items: Array<{ label: string; active: boolean; disabled?: boolean; onPick: () => void }>;
}) {
  return (
    <div className="min-w-[15.75rem] space-y-4 p-3">
      <div className="relative flex items-center justify-center pt-1">
        <button type="button" className={cn(navButtonClass, "absolute left-1")} onClick={onPrev} aria-label="Previous">
          <ChevronLeft className="h-4 w-4" />
        </button>
        {onTitleClick ? (
          <button type="button" className={headerButtonClass} onClick={onTitleClick}>{title}</button>
        ) : (
          <span className="px-2 py-1 text-sm font-medium">{title}</span>
        )}
        <button type="button" className={cn(navButtonClass, "absolute right-1")} onClick={onNext} aria-label="Next">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.onPick}
            disabled={item.disabled}
            className={cn(
              "h-11 rounded-md text-sm disabled:pointer-events-none disabled:opacity-30 font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10",
              item.active && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Calendar({ className, classNames, showOutsideDays = true, fixedWeeks = true, ...props }: CalendarProps) {
  // DayPicker opens on today's month unless told otherwise, so start on the
  // already-selected date's month when there is one.
  const selectedDate = props.mode === "single" && props.selected instanceof Date ? props.selected : undefined;
  const [month, setMonth] = React.useState<Date>(() => props.month ?? props.defaultMonth ?? selectedDate ?? new Date());
  const [view, setView] = React.useState<View>("days");
  const [yearPageStart, setYearPageStart] = React.useState(0);
  const contextValue = React.useMemo(() => ({
    openView: (next: View) => {
      if (next === "years") setYearPageStart(month.getFullYear() - (month.getFullYear() % YEARS_PER_PAGE));
      setView(next);
    },
  }), [month]);

  const withMonth = (year: number, monthIndex: number) => new Date(year, monthIndex, 1);
  const year = month.getFullYear();
  const { fromDate, toDate } = props;
  const monthOutOfRange = (y: number, m: number) =>
    Boolean((fromDate && new Date(y, m + 1, 0) < fromDate) || (toDate && new Date(y, m, 1) > toDate));

  if (view === "months") {
    return (
      <PickerGrid
        title={String(year)}
        onTitleClick={() => contextValue.openView("years")}
        onPrev={() => setMonth(withMonth(year - 1, month.getMonth()))}
        onNext={() => setMonth(withMonth(year + 1, month.getMonth()))}
        items={MONTH_NAMES.map((label, index) => ({
          label,
          active: index === month.getMonth(),
          disabled: monthOutOfRange(year, index),
          onPick: () => { setMonth(withMonth(year, index)); setView("days"); },
        }))}
      />
    );
  }

  if (view === "years") {
    return (
      <PickerGrid
        title={`${yearPageStart} – ${yearPageStart + YEARS_PER_PAGE - 1}`}
        onPrev={() => setYearPageStart(yearPageStart - YEARS_PER_PAGE)}
        onNext={() => setYearPageStart(yearPageStart + YEARS_PER_PAGE)}
        items={Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearPageStart + i).map((y) => ({
          label: String(y),
          active: y === year,
          disabled: Boolean((fromDate && y < fromDate.getFullYear()) || (toDate && y > toDate.getFullYear())),
          onPick: () => { setMonth(withMonth(y, month.getMonth())); setView("months"); },
        }))}
      />
    );
  }

  return (
    <ViewContext.Provider value={contextValue}>
      <DayPicker
        showOutsideDays={showOutsideDays}
        // Always render 7 columns x 6 rows so the popup keeps the same size when
        // switching between months with fewer weeks.
        fixedWeeks={fixedWeeks}
        className={cn("p-3", className)}
        classNames={{
          months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
          month: "space-y-4",
          table: "w-full border-collapse space-y-1",
          head_row: "flex",
          head_cell: "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
          row: "flex w-full mt-2",
          cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
          day: cn(buttonVariants({ variant: "ghost" }), "h-9 w-9 p-0 font-normal aria-selected:opacity-100"),
          day_range_end: "day-range-end",
          day_selected:
            "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
          day_today: "bg-accent text-accent-foreground",
          day_outside:
            "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
          day_disabled: "text-muted-foreground opacity-50",
          day_range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
          day_hidden: "invisible",
          ...classNames,
        }}
        components={{ Caption: CalendarCaption }}
        {...props}
        month={month}
        onMonthChange={(next) => { setMonth(next); props.onMonthChange?.(next); }}
      />
    </ViewContext.Provider>
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
