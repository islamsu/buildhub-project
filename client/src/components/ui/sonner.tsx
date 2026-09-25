import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const { lang } = useLanguage();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      /*
       * SONNER NAMES ITS OWN REGION, AND IT NAMES IT IN ENGLISH.
       *
       * The library injects `<section aria-label="Notifications alt+T">`, so
       * a screen-reader user on an Arabic page heard the toast region
       * announced in English on every screen in the product - including the
       * keyboard hint, which is the one part that actually needed
       * translating for them to use it.
       *
       * Invisible to a sighted reader and invisible to any test that looks
       * at visible text; found by the visual-QA sweep, which scans
       * accessible names (§62, §67).
       */
      containerAriaLabel={lang === 'ar' ? 'الإشعارات alt+T' : 'Notifications alt+T'}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
