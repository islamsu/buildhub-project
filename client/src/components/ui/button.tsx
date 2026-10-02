import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        /*
         * THE AMBER CALL TO ACTION, as a variant rather than a class string
         * pasted onto a button.
         *
         * The approved design puts amber on the single most important action
         * on a surface - Sign Up, Search, Join Rakiza. It exists here so that
         * treatment is one decision in one place (§49), and so the one rule
         * it must obey cannot be forgotten at a call site.
         *
         * THE LABEL IS DARK, AND THAT IS NOT A STYLE CHOICE. Accent Amber
         * against white is 2.15:1 - it fails AA for normal text, large text
         * and non-text UI alike - and white ON amber is the same 2.15:1. The
         * reference mockup shows white labels on amber fills; the owner ruled
         * that accessibility overrides literal screenshot reproduction.
         * `text-foreground` is Text Dark at 8.26:1, and the 600 hover step
         * still clears 5.71:1 so darkening on hover does not darken past
         * legibility. brandContrast.test.ts fails the build if a white label
         * is ever paired with an amber fill.
         */
        accent:
          "bg-brand-accent-500 text-foreground hover:bg-brand-accent-600 shadow-xs "
          + "focus-visible:ring-brand-accent-600/60",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border bg-transparent shadow-xs hover:bg-accent dark:bg-transparent dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
