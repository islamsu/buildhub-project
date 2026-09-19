import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A 16x16 CHECKBOX IS A 16x16 TAP TARGET, and that is a coin toss on a phone.
 *
 * WCAG 2.5.8 sets 24x24 as the minimum. The box itself stays 16px - shrinking
 * the visual design to satisfy a number would be the wrong trade, and a larger
 * box would not match the rest of the form - so the HIT AREA is grown instead,
 * with an invisible pseudo-element centred on the control. Nothing moves, the
 * layout is unchanged, and a thumb has something to aim at.
 *
 * Measured at 375px on the registrations and placements screens, where the
 * real checkboxes came back at 16x16 and 13x13.
 */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "relative after:absolute after:left-1/2 after:top-1/2 after:size-6 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] peer border-input dark:bg-input/30 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary data-[state=checked]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
