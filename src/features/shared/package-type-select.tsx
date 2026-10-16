// Package-type picker backed by the package_types master. Value is the
// package_types id (product_packaging_profiles.package_type_id).
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePackageTypes } from "@/features/shared/package-types";

export function PackageTypeSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  value: string | null | undefined;
  onChange: (packageTypeId: string) => void;
  disabled?: boolean;
}) {
  const { data: types = [], isLoading } = usePackageTypes();
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled || isLoading}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={isLoading ? "Loading…" : "Select package type"} />
      </SelectTrigger>
      <SelectContent>
        {types.map((type) => (
          <SelectItem key={type.id} value={type.id}>
            {type.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
