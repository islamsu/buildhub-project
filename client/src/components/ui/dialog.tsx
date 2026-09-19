import { cn } from "@/lib/utils";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import * as React from "react";

// Context to track composition state across dialog children
const DialogCompositionContext = React.createContext<{
  isComposing: () => boolean;
  setComposing: (composing: boolean) => void;
  justEndedComposing: () => boolean;
  markCompositionEnd: () => void;
}>({
  isComposing: () => false,
  setComposing: () => {},
  justEndedComposing: () => false,
  markCompositionEnd: () => {},
});

export const useDialogComposition = () =>
  React.useContext(DialogCompositionContext);

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const composingRef = React.useRef(false);
  const justEndedRef = React.useRef(false);
  const endTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const contextValue = React.useMemo(
    () => ({
      isComposing: () => composingRef.current,
      setComposing: (composing: boolean) => {
        composingRef.current = composing;
      },
      justEndedComposing: () => justEndedRef.current,
      markCompositionEnd: () => {
        justEndedRef.current = true;
        if (endTimerRef.current) {
          clearTimeout(endTimerRef.current);
        }
        endTimerRef.current = setTimeout(() => {
          justEndedRef.current = false;
        }, 150);
      },
    }),
    []
  );

  return (
    <DialogCompositionContext.Provider value={contextValue}>
      <DialogPrimitive.Root data-slot="dialog" {...props} />
    </DialogCompositionContext.Provider>
  );
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  );
}

DialogOverlay.displayName = "DialogOverlay";

function DialogContent({
  className,
  children,
  showCloseButton = true,
  onEscapeKeyDown,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
}) {
  const { isComposing } = useDialogComposition();

  /**
   * WHERE FOCUS GOES WHEN THE DIALOG CLOSES.
   *
   * Radix restores focus to whatever held it when the dialog opened, which is
   * correct - right up until that element is gone. Almost every dialog in this
   * product is driven by STATE rather than by a DialogTrigger: the opener sets
   * `auditTarget`, the dialog renders, and closing sets it back to null, which
   * re-renders the list the opener lives in. The saved node is replaced, Radix
   * has nothing to return to, and focus falls to <body> - so a keyboard user
   * who opened a row's dialog is put back at the top of the page and has to
   * tab through the whole table to reach where they were. Proved in a browser:
   * Escape closed the dialog, and document.activeElement was BODY.
   *
   * THE OPENER IS TRACKED OUTSIDE THE DIALOG'S LIFECYCLE, deliberately. The
   * first version of this captured `document.activeElement` in a mount effect
   * and saved the dialog's own Close button - Radix moves focus into the
   * content before a child effect runs, so by then the opener is already gone
   * from `activeElement`. A `focusin` listener that ignores anything inside a
   * dialog always holds the right element, whatever order the effects run in.
   *
   * Remembered by IDENTITY while the node is attached, and by `data-testid`
   * when it is not - React reuses the test id across a re-render even when the
   * DOM node is new. Fixed here, once, because it is the same defect in all
   * thirty-two of them.
   */
  /*
   * CAPTURED WHEN THE CONTENT NODE ATTACHES, which is the only moment that
   * actually holds the opener.
   *
   * Three earlier attempts missed it, each for its own reason, and the reasons
   * are worth keeping because they are all about ordering:
   *
   *   a mount EFFECT            ran after Radix had moved focus, so it saved
   *                             the dialog's own Close button
   *   a `focusin` LISTENER      correct in a real browser, invisible to a
   *                             headless one with no system focus, so it could
   *                             not be proved
   *   a useRef INITIALISER      ran at page load, because this component is in
   *                             the tree the whole time - only Radix's portal
   *                             renders conditionally - so it saved <body>
   *
   * A callback ref fires when the element is inserted, which happens on open
   * and BEFORE any effect runs. At that instant `document.activeElement` is
   * still whatever the person clicked.
   */
  const openerRef = React.useRef<HTMLElement | null>(null);
  const openerTestId = React.useRef<string | null>(null);

  const captureOpener = React.useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement
        && active !== document.body
        && !active.closest('[data-slot="dialog-content"]')) {
      openerRef.current = active;
      openerTestId.current = active.getAttribute('data-testid');
    }
  }, []);

  React.useEffect(() => () => {
    const opener = openerRef.current;
    const testId = openerTestId.current;
    /*
     * Deferred: Radix runs its own restoration as the content unmounts, and
     * this must be the last word rather than a race with it. It only acts when
     * focus has actually been dropped on <body>, so a dialog that closes into
     * a deliberate destination is left alone.
     *
     * Remembered by IDENTITY while the node is attached, and by `data-testid`
     * when it is not - closing a state-driven dialog re-renders the list its
     * opener lives in, and React reuses the test id across that render even
     * when the DOM node is new.
     */
    setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      const stillThere = opener && opener.isConnected ? opener : null;
      const byTestId = !stillThere && testId
        ? document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(testId)}"]`)
        : null;
      (stillThere ?? byTestId)?.focus();
    }, 0);
  }, []);

  const handleCloseAutoFocus = React.useCallback(
    (event: Event) => {
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return;
      const opener = openerRef.current;
      if (opener && opener.isConnected) {
        event.preventDefault();
        opener.focus();
      }
    },
    [onCloseAutoFocus],
  );

  const handleEscapeKeyDown = React.useCallback(
    (e: KeyboardEvent) => {
      // Check both the native isComposing property and our context state
      // This handles Safari's timing issues with composition events
      const isCurrentlyComposing = (e as any).isComposing || isComposing();

      // If IME is composing, prevent dialog from closing
      if (isCurrentlyComposing) {
        e.preventDefault();
        return;
      }

      // Call user's onEscapeKeyDown if provided
      onEscapeKeyDown?.(e);
    },
    [isComposing, onEscapeKeyDown]
  );

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg",
          className
        )}
        ref={captureOpener}
        onEscapeKeyDown={handleEscapeKeyDown}
        onCloseAutoFocus={handleCloseAutoFocus}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger
};

