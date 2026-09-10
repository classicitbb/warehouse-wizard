import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type ProductOption = {
  id: string;
  sku: string;
  name: string;
  barcode?: string;
  /**
   * Pack-standard state, shown as a dot in the list. Green means this SKU
   * already has a saved standard, amber means it still has to be created.
   */
  packStatus?: "saved" | "none";
  meta?: {
    totalQty: number;
    palletCount: number;
    palletCode?: string;
    palletQty?: number;
    locationCode?: string;
  };
};

export type ProductSearchHandle = {
  open: () => void;
  scanBarcode: (raw: string) => boolean;
};

type Props = {
  value: string;
  onChange: (id: string) => void;
  options: ProductOption[];
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  onSelectComplete?: () => void;
};

export const ProductSearch = forwardRef<ProductSearchHandle, Props>(function ProductSearch(
  { value, onChange, options, placeholder = "Search product by code or name…", disabled, error, onSelectComplete },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const preventCloseAutoFocusRef = useRef(false);

  const selected = options.find((o) => o.id === value);

  const filtered =
    query.length === 0
      ? options.slice(0, 60)
      : options
          .filter((o) => {
            const q = query.toLowerCase();
            return (
              o.sku.toLowerCase().includes(q) ||
              o.name.toLowerCase().includes(q) ||
              (o.barcode && o.barcode.toLowerCase().includes(q))
            );
          })
          .slice(0, 60);

  // USB/Bluetooth HID scanner: exact barcode match → auto-select
  useEffect(() => {
    if (!query) return;
    const match = options.find((o) => o.barcode && o.barcode === query);
    if (match) {
      preventCloseAutoFocusRef.current = Boolean(onSelectComplete);
      onChange(match.id);
      setQuery("");
      setOpen(false);
      setTimeout(() => onSelectComplete?.(), 0);
    }
  }, [query, options, onChange, onSelectComplete]);

  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      },
      scanBarcode: (raw: string) => {
        const match = options.find((o) => o.barcode && o.barcode === raw);
        if (match) {
          preventCloseAutoFocusRef.current = Boolean(onSelectComplete);
          onChange(match.id);
          setQuery("");
          setOpen(false);
          setTimeout(() => onSelectComplete?.(), 0);
          return true;
        }
        setQuery(raw);
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
        return false;
      },
    }),
    [options, onChange, onSelectComplete],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={selected ? `Product ${selected.sku} ${selected.name}` : placeholder}
          disabled={disabled}
          className={cn(
            "h-10 w-full min-w-0 max-w-full justify-between overflow-hidden font-normal focus-visible:border-ring focus-visible:ring-0 focus-visible:shadow-[inset_0_0_0_1px_hsl(var(--ring)),inset_0_0_0_9999px_hsl(var(--ring)/0.04)]",
            !selected && "text-muted-foreground",
            error && "border-destructive",
          )}
          onClick={() => {
            setOpen(true);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
        >
          <span className="flex min-w-0 items-center gap-2 truncate">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {selected ? `${selected.sku} · ${selected.name}` : placeholder}
            </span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        onCloseAutoFocus={(event) => {
          if (!preventCloseAutoFocusRef.current) return;
          event.preventDefault();
          preventCloseAutoFocusRef.current = false;
        }}
      >
        <Command shouldFilter={false}>
          <CommandInput
            ref={inputRef}
            placeholder="Type SKU, name, or scan barcode…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-72 overflow-y-auto">
            <CommandEmpty>No products matched. Check the SKU or name.</CommandEmpty>
            <CommandGroup>
              {filtered.map((product) => (
                <CommandItem
                  key={product.id}
                  value={product.id}
                  onSelect={() => {
                    preventCloseAutoFocusRef.current = Boolean(onSelectComplete);
                    onChange(product.id);
                    setQuery("");
                    setOpen(false);
                    setTimeout(() => onSelectComplete?.(), 0);
                  }}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4 shrink-0", value === product.id ? "opacity-100" : "opacity-0")}
                  />
                  {product.meta ? (
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate">
                          <span className="font-mono text-xs text-muted-foreground mr-2">{product.sku}</span>
                          <span>{product.name}</span>
                        </span>
                        <span className="shrink-0 text-xs font-semibold tabular-nums">
                          Total {product.meta.totalQty}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                        <span className="truncate font-mono">
                          {product.meta.palletCode
                            ? `Pallet ${product.meta.palletCode} · Qty ${product.meta.palletQty}${product.meta.locationCode ? ` @ ${product.meta.locationCode}` : ""}`
                            : "No pickable pallets"}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {product.meta.palletCount} pallet{product.meta.palletCount === 1 ? "" : "s"}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="font-mono text-xs text-muted-foreground mr-2">{product.sku}</span>
                      <span className="truncate">{product.name}</span>
                    </>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});
