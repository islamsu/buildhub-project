import { useState } from 'react';
import { Plus, Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';
import {
  SERVICE_PRICING_BASES, DEFAULT_PRICING_BASIS, basisAcceptsPrice,
  pricingBasisLabel, pricingBasisHelp, SERVICE_TITLE_MAX, SERVICE_DESCRIPTION_MAX,
  type ServicePricingBasis, type ServiceStatus,
} from '@shared/serviceCatalogue';

/**
 * A PROVIDER'S CATALOGUE OF WORK.
 *
 * The counterpart of the supplier's product list, for the roles that sell work
 * rather than goods. Before this, a contractor could declare one of nine RFQ
 * categories - "Renovation" - and a customer looking for bathroom waterproofing
 * saw a badge.
 *
 * THE PRICE FIELD DISAPPEARS ON "QUOTE ON REQUEST", rather than being shown and
 * then rejected. The server refuses that combination outright, and a form that
 * offers a box the server will refuse is a form that teaches people to distrust
 * it. The help line under the choice says what each basis means, because "per
 * linear metre" is not self-evident to everyone listing a service.
 *
 * DRAFTS ARE VISIBLE HERE AND NOWHERE ELSE, and a provider still being vetted
 * can write them. Publishing is the act that needs approval, and the button
 * says so instead of silently failing.
 */
export default function ServiceCatalogueManager() {
  const { t, lang } = useLanguage();
  const ar = lang === 'ar';
  const utils = trpc.useUtils();
  const services = trpc.services.mine.useQuery(undefined, { retry: false });
  const categories = trpc.services.categories.useQuery(undefined, { retry: false });
  const [editing, setEditing] = useState<number | 'new' | null>(null);

  const invalidate = () => { void utils.services.mine.invalidate(); };
  const onError = (error: { message: string }) => toast.error(error.message);

  const create = trpc.services.create.useMutation({
    onSuccess: () => { toast.success(t('svc.saved')); setEditing(null); invalidate(); }, onError,
  });
  const update = trpc.services.update.useMutation({
    onSuccess: () => { toast.success(t('svc.saved')); setEditing(null); invalidate(); }, onError,
  });
  const setStatus = trpc.services.setStatus.useMutation({
    onSuccess: () => { toast.success(t('svc.statusChanged')); invalidate(); }, onError,
  });

  if (services.isError) {
    return (
      <Card data-testid="service-catalogue">
        <CardContent className="pt-6">
          <LoadFailed {...loadFailedCopy(ar)} onRetry={() => void services.refetch()} />
        </CardContent>
      </Card>
    );
  }
  if (!services.data || !categories.data) {
    return (
      <Card data-testid="service-catalogue-loading">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        </CardContent>
      </Card>
    );
  }

  const categoryName = (row: { categoryNameEn: string; categoryNameAr: string }) =>
    ar ? row.categoryNameAr : row.categoryNameEn;

  return (
    <Card data-testid="service-catalogue">
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="text-sm text-muted-foreground max-w-xl">{t('svc.intro')}</p>
          <Button size="sm" className="gap-2" onClick={() => setEditing('new')} data-testid="service-add">
            <Plus className="h-4 w-4" aria-hidden="true" />{t('svc.add')}
          </Button>
        </div>

        {editing === 'new' && (
          <ServiceForm
            categories={categories.data}
            onCancel={() => setEditing(null)}
            pending={create.isPending}
            onSubmit={values => create.mutate(values)}
          />
        )}

        {/* A TRUTHFUL EMPTY STATE. No sample services, no placeholder rows. */}
        {services.data.length === 0 && editing !== 'new' && (
          <p className="py-8 text-center text-sm text-muted-foreground" data-testid="service-empty">
            {t('svc.empty')}
          </p>
        )}

        <div className="space-y-3">
          {services.data.map(row => editing === row.id ? (
            <ServiceForm
              key={row.id}
              categories={categories.data}
              initial={{
                title: row.title,
                description: row.description ?? '',
                categoryId: row.categoryId,
                pricingBasis: row.pricingBasis as ServicePricingBasis,
                priceMin: row.priceMin == null ? '' : String(row.priceMin),
                priceMax: row.priceMax == null ? '' : String(row.priceMax),
                leadTimeDays: row.leadTimeDays == null ? '' : String(row.leadTimeDays),
                warrantyMonths: row.warrantyMonths == null ? '' : String(row.warrantyMonths),
              }}
              onCancel={() => setEditing(null)}
              pending={update.isPending}
              onSubmit={values => update.mutate({ serviceId: row.id, ...values })}
            />
          ) : (
            <div key={row.id} className="rounded-lg border p-4" data-testid={`service-row-${row.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{row.title}</span>
                    <Badge variant={row.status === 'active' ? 'default' : 'secondary'} data-testid={`service-status-${row.id}`}>
                      {t(`serviceStatus.${row.status}`)}
                    </Badge>
                    <Badge variant="outline" className="font-normal">{categoryName(row)}</Badge>
                  </div>
                  {row.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{row.description}</p>
                  )}
                  <p className="mt-1 text-sm" data-testid={`service-price-${row.id}`}>
                    {/* NO PRICE IS SHOWN when the basis is quote on request -
                        there is no figure to show, and inventing "from EGP 0"
                        would be worse than the honest sentence. */}
                    {row.pricingBasis === 'quote_on_request'
                      ? pricingBasisLabel('quote_on_request', lang)
                      : `${formatRange(row.priceMin, row.priceMax, ar)} · ${pricingBasisLabel(row.pricingBasis as ServicePricingBasis, lang)}`}
                  </p>
                  {(row.leadTimeDays != null || row.warrantyMonths != null) && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {[
                        row.leadTimeDays != null ? `${t('svc.leadTime')}: ${row.leadTimeDays} ${t('svc.days')}` : null,
                        row.warrantyMonths != null ? `${t('svc.warranty')}: ${row.warrantyMonths} ${t('svc.months')}` : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => setEditing(row.id)} data-testid={`service-edit-${row.id}`}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />{t('common.edit')}
                  </Button>
                  {/* ONLY THE DECLARED MOVES ARE OFFERED. A button for a
                      transition the server refuses is a dead control. */}
                  {(row.status === 'draft' || row.status === 'inactive') && (
                    <Button size="sm" disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ serviceId: row.id, status: 'active' })}
                      data-testid={`service-publish-${row.id}`}>
                      {t('svc.publish')}
                    </Button>
                  )}
                  {row.status === 'active' && (
                    <Button variant="outline" size="sm" disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ serviceId: row.id, status: 'inactive' })}
                      data-testid={`service-delist-${row.id}`}>
                      {t('svc.delist')}
                    </Button>
                  )}
                  {row.status !== 'archived' && (
                    <Button variant="ghost" size="sm" disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ serviceId: row.id, status: 'archived' })}
                      data-testid={`service-archive-${row.id}`}>
                      {t('svc.archive')}
                    </Button>
                  )}
                  {row.status === 'archived' && (
                    <Button variant="outline" size="sm" disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ serviceId: row.id, status: 'inactive' })}
                      data-testid={`service-restore-${row.id}`}>
                      {t('svc.restore')}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** "EGP 120 – 260", "from EGP 120", "up to EGP 260", or nothing at all. */
function formatRange(min: unknown, max: unknown, ar: boolean): string {
  const currency = ar ? 'ج.م' : 'EGP';
  const n = (value: unknown) => Number(value).toLocaleString(ar ? 'ar-EG' : 'en-EG');
  if (min != null && max != null) return `${currency} ${n(min)} – ${n(max)}`;
  if (min != null) return ar ? `من ${currency} ${n(min)}` : `from ${currency} ${n(min)}`;
  if (max != null) return ar ? `حتى ${currency} ${n(max)}` : `up to ${currency} ${n(max)}`;
  return ar ? 'السعر غير محدد' : 'Price not stated';
}

type FormValues = {
  title: string; description: string; categoryId: number;
  pricingBasis: ServicePricingBasis;
  priceMin: string; priceMax: string; leadTimeDays: string; warrantyMonths: string;
};

function ServiceForm({ categories, initial, onSubmit, onCancel, pending }: {
  categories: { id: number; nameEn: string; nameAr: string }[];
  initial?: FormValues;
  onSubmit: (values: any) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const { t, lang } = useLanguage();
  const ar = lang === 'ar';
  const [values, setValues] = useState<FormValues>(initial ?? {
    title: '', description: '', categoryId: categories[0]?.id ?? 0,
    pricingBasis: DEFAULT_PRICING_BASIS,
    priceMin: '', priceMax: '', leadTimeDays: '', warrantyMonths: '',
  });
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues(current => ({ ...current, [key]: value }));

  const showsPrice = basisAcceptsPrice(values.pricingBasis);
  const num = (raw: string) => raw.trim() === '' ? undefined : Number(raw);

  const submit = () => {
    if (!values.title.trim()) { toast.error(t('svc.titleRequired')); return; }
    if (!values.categoryId) { toast.error(t('svc.categoryRequired')); return; }
    onSubmit({
      title: values.title.trim(),
      description: values.description.trim() || undefined,
      categoryId: values.categoryId,
      pricingBasis: values.pricingBasis,
      // THE FIGURES ARE NOT SENT when the basis does not carry one. The server
      // refuses that combination, and sending a stale number from a field the
      // provider can no longer see would fail a save they did not understand.
      priceMin: showsPrice ? num(values.priceMin) : undefined,
      priceMax: showsPrice ? num(values.priceMax) : undefined,
      leadTimeDays: num(values.leadTimeDays),
      warrantyMonths: num(values.warrantyMonths),
    });
  };

  return (
    <div className="space-y-4 rounded-lg border p-4" data-testid="service-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-sm font-medium">{t('svc.title')}</span>
          <Input value={values.title} maxLength={SERVICE_TITLE_MAX}
            onChange={event => set('title', event.target.value)}
            placeholder={t('svc.titlePlaceholder')} data-testid="service-field-title" />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">{t('svc.category')}</span>
          <select
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={values.categoryId}
            onChange={event => set('categoryId', Number(event.target.value))}
            data-testid="service-field-category"
          >
            {categories.map(category => (
              <option key={category.id} value={category.id}>{ar ? category.nameAr : category.nameEn}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium">{t('svc.description')}</span>
        <Textarea value={values.description} maxLength={SERVICE_DESCRIPTION_MAX} rows={3}
          onChange={event => set('description', event.target.value)}
          placeholder={t('svc.descriptionPlaceholder')} data-testid="service-field-description" />
      </label>

      <div>
        <span className="text-sm font-medium">{t('svc.pricingBasis')}</span>
        <select
          className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm sm:max-w-xs"
          value={values.pricingBasis}
          onChange={event => set('pricingBasis', event.target.value as ServicePricingBasis)}
          data-testid="service-field-basis"
        >
          {SERVICE_PRICING_BASES.map(basis => (
            <option key={basis} value={basis}>{pricingBasisLabel(basis, lang)}</option>
          ))}
        </select>
        <p className="mt-1 text-sm text-muted-foreground" data-testid="service-basis-help">
          {pricingBasisHelp(values.pricingBasis, lang)}
        </p>
      </div>

      {/* THE PRICE FIELDS ARE ABSENT, not disabled, on quote on request: the
          server refuses that pairing, and offering a box it will refuse
          teaches a provider to distrust the form. */}
      {showsPrice && (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="service-price-fields">
          <label className="space-y-1">
            <span className="text-sm font-medium">{t('svc.priceMin')}</span>
            <Input type="number" min="0" value={values.priceMin}
              onChange={event => set('priceMin', event.target.value)} data-testid="service-field-priceMin" />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">{t('svc.priceMax')}</span>
            <Input type="number" min="0" value={values.priceMax}
              onChange={event => set('priceMax', event.target.value)} data-testid="service-field-priceMax" />
          </label>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-sm font-medium">{t('svc.leadTime')}</span>
          <Input type="number" min="0" value={values.leadTimeDays}
            onChange={event => set('leadTimeDays', event.target.value)} data-testid="service-field-leadTime" />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">{t('svc.warranty')}</span>
          <Input type="number" min="0" value={values.warrantyMonths}
            onChange={event => set('warrantyMonths', event.target.value)} data-testid="service-field-warranty" />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="gap-1" onClick={submit} disabled={pending} data-testid="service-save">
          <Check className="h-4 w-4" aria-hidden="true" />{t('common.save')}
        </Button>
        <Button variant="outline" size="sm" className="gap-1" onClick={onCancel} disabled={pending} data-testid="service-cancel">
          <X className="h-4 w-4" aria-hidden="true" />{t('common.cancel')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t('svc.draftNote')}</p>
    </div>
  );
}
