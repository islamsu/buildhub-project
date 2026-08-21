import { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { rfqCategoryLabel } from '@shared/rfqCategories';
import { Tags, Check } from 'lucide-react';

/**
 * Phase 4B.3: a vendor declares which service categories describe their work,
 * from the shared nine-value RFQ taxonomy. These declarations are what make
 * RFQ targeting possible - BuildHub never infers them from a provider role.
 *
 * The per-plan cap and the list of valid categories both come from the server;
 * this component never decides either.
 */
export default function VendorServiceCategories() {
  const { lang, t } = useLanguage();
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.profile.myCategories.useQuery();
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (data?.categories) setSelected(data.categories);
  }, [data?.categories]);

  const save = trpc.profile.setMyCategories.useMutation({
    onSuccess: () => {
      toast.success(t('vendorCats.updated'));
      utils.profile.myCategories.invalidate();
      utils.rfq.eligible.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground py-4">{t('common.loading')}</div>;
  }
  if (!data) return null;

  const limit = data.limit;
  const atLimit = limit !== null && selected.length >= limit;
  const dirty = JSON.stringify([...selected].sort()) !== JSON.stringify([...data.categories].sort());

  const toggle = (category: string) => {
    setSelected(current =>
      current.includes(category)
        ? current.filter(item => item !== category)
        : atLimit ? current : [...current, category],
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Tags className="w-4 h-4" />
          {t('vendorCats.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
          {t('vendorCats.intro')}
          {limit !== null && (
            <span className="block mt-1">
              {`${t('vendorCats.planAllows')} ${limit} ${t('vendorCats.categoriesUnit')} (${selected.length}/${limit}).`}
            </span>
          )}
        </p>

        <div className="flex flex-wrap gap-2">
          {data.available.map(category => {
            const isSelected = selected.includes(category);
            const disabled = !isSelected && atLimit;
            return (
              <button
                key={category}
                type="button"
                disabled={disabled}
                aria-pressed={isSelected}
                onClick={() => toggle(category)}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-colors
                  ${isSelected ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted'}
                  ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                {isSelected && <Check className="w-3 h-3" />}
                {rfqCategoryLabel(category, lang)}
              </button>
            );
          })}
        </div>

        {selected.length === 0 && (
          <p className="text-xs text-amber-600 mt-3">
            {t('vendorCats.noneSelected')}
          </p>
        )}

        <div className="flex items-center gap-2 mt-4">
          <Button
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate({ categories: selected })}
          >
            {save.isPending ? t('common.loading') : t('common.save')}
          </Button>
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => setSelected(data.categories)}>
              {t('common.cancel')}
            </Button>
          )}
          {!dirty && data.categories.length > 0 && (
            <Badge variant="outline" className="text-[10px]">{t('vendorCats.saved')}</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
