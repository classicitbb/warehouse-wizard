// Settings > Integrations: one collapsible section of the NetSuite accordion.
import type { ReactNode } from "react";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export function NetSuiteSection({ value, icon, title, description, children }: {
  value: string;
  icon?: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <AccordionItem value={value} className="border-b px-1 last:border-b-0">
      <AccordionTrigger className="gap-3 text-left hover:no-underline">
        <span className="grid gap-1">
          <span className="flex items-center gap-2 text-base font-semibold">{icon}{title}</span>
          <span className="text-sm font-normal text-muted-foreground">{description}</span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="px-1 pt-2">{children}</AccordionContent>
    </AccordionItem>
  );
}
