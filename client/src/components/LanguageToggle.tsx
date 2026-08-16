import { Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

type LanguageToggleProps = {
  className?: string;
  showLabel?: boolean;
};

export default function LanguageToggle({ className, showLabel = true }: LanguageToggleProps) {
  const { lang, setLang } = useLanguage();
  const nextLanguage = lang === 'en' ? 'ar' : 'en';

  return (
    <Button
      type="button"
      variant="ghost"
      size={showLabel ? 'sm' : 'icon'}
      onClick={() => setLang(nextLanguage)}
      aria-label={lang === 'en' ? 'Switch to Arabic' : 'التبديل إلى الإنجليزية'}
      title={lang === 'en' ? 'Switch to Arabic' : 'التبديل إلى الإنجليزية'}
      className={cn('gap-1.5 text-sm font-medium', className)}
    >
      <Globe className="h-4 w-4" aria-hidden="true" />
      {showLabel && (lang === 'en' ? 'العربية' : 'English')}
    </Button>
  );
}
