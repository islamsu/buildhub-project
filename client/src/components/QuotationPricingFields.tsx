/**
 * ── HOW A CONTRACTOR SAYS HOW THEY PRICED IT ────────────────────────────
 *
 * Finishing work in this market is priced three ways and the form offered one
 * box labelled "Price". A contractor who works on نسبة من تكلفة المواد had to
 * multiply it out in their head, type the answer, and put the percentage in the
 * notes if they remembered - and the customer received a number with no
 * derivation and no way to check it.
 *
 * ── THE PREVIEW USES THE SERVER'S OWN FUNCTION ──────────────────────────
 *
 * `computeQuotationTotals` is imported from shared/ and is the same code the
 * server runs. That is the only reason it is safe to show a total here: if this
 * file did its own arithmetic, the number on the screen and the number in the
 * database would be two answers to the same question, and the one the
 * contractor saw would be the one they did not get.
 *
 * NOTHING HERE IS SUBMITTED AS A TOTAL. The preview is a preview. The payload
 * carries the INPUTS, the server computes the total from them, and for every
 * method but `custom` the server refuses a submitted total outright.
 */
import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2 } from 'lucide-react';
import { formatMoney } from '@shared/money';
import {
  PRICING_METHODS, PRICING_METHOD_LABELS, COST_COMPONENTS, COST_COMPONENT_LABELS,
  SUGGESTED_PACKAGE_TIERS, PACKAGE_TIER_LABELS,
  computeQuotationTotals, UnknownCurrencyScaleError,
  type PricingMethod, type CostComponent, type QuotationTotals,
} from '@shared/quotationPricing';
import { SERVICE_PRICING_BASES, pricingBasisLabel, type ServicePricingBasis } from '@shared/serviceCatalogue';
import { pricingPreferenceLabel, isPricingPreference } from '@shared/finishing';

/** A BOQ row while it is being typed: strings, because inputs hold strings. */
export type DraftLine = {
  component: CostComponent;
  tradeGroup: string;
  description: string;
  quantity: string;
  unit: string;
  rate: string;
};

export type PricingDraft = {
  method: PricingMethod;
  /** custom */
  price: string;
  /** percentage */
  materialBaseAmount: string;
  percentageRate: string;
  percentageBasisNote: string;
  /** package */
  packageTier: string;
  packageBasis: ServicePricingBasis | '';
  packageRate: string;
  packageQuantity: string;
  /** detailed */
  lines: DraftLine[];
  /** shared */
  discountAmount: string;
  contingencyRate: string;
  overheadRate: string;
  vatRate: string;
};

export const EMPTY_LINE: DraftLine = {
  component: 'material', tradeGroup: '', description: '', quantity: '', unit: '', rate: '',
};

export const EMPTY_PRICING: PricingDraft = {
  method: 'custom',
  price: '',
  materialBaseAmount: '', percentageRate: '', percentageBasisNote: '',
  packageTier: '', packageBasis: '', packageRate: '', packageQuantity: '',
  lines: [{ ...EMPTY_LINE }],
  discountAmount: '', contingencyRate: '', overheadRate: '', vatRate: '',
};

const num = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * The payload shape `rfq.submitQuotation` expects for these fields.
 *
 * NOTE WHAT IS ABSENT: a total. For `custom` the stated `price` goes through as
 * it always did; for the other three there is no price field in the payload at
 * all, and the server rejects one if it appears.
 */
export function pricingPayload(draft: PricingDraft) {
  const shared = {
    discountAmount: num(draft.discountAmount) ?? undefined,
    contingencyRate: num(draft.contingencyRate) ?? undefined,
    overheadRate: num(draft.overheadRate) ?? undefined,
    vatRate: num(draft.vatRate) ?? undefined,
  };
  switch (draft.method) {
    case 'percentage':
      return {
        pricingMethod: 'percentage' as const,
        materialBaseAmount: num(draft.materialBaseAmount) ?? undefined,
        percentageRate: num(draft.percentageRate) ?? undefined,
        percentageBasisNote: draft.percentageBasisNote.trim() || undefined,
        ...shared,
      };
    case 'package':
      return {
        pricingMethod: 'package' as const,
        packageTier: draft.packageTier.trim() || undefined,
        packageBasis: (draft.packageBasis || undefined) as ServicePricingBasis | undefined,
        packageRate: num(draft.packageRate) ?? undefined,
        // A fixed-project package is its amount times one; the server sets that,
        // so no quantity is sent for it at all.
        packageQuantity: draft.packageBasis === 'fixed_project'
          ? undefined : (num(draft.packageQuantity) ?? undefined),
        ...shared,
      };
    case 'detailed':
      return {
        pricingMethod: 'detailed' as const,
        lines: draft.lines
          .filter(line => line.description.trim() && num(line.quantity) && num(line.rate) !== null)
          .map(line => ({
            component: line.component,
            tradeGroup: line.tradeGroup.trim() || undefined,
            description: line.description.trim(),
            quantity: num(line.quantity) as number,
            unit: line.unit.trim() || undefined,
            rate: num(line.rate) as number,
          })),
        ...shared,
      };
    case 'custom':
    default:
      return { pricingMethod: 'custom' as const, price: num(draft.price) ?? undefined, ...shared };
  }
}

/** The preview, or null when the inputs do not yet describe a price. */
export function previewTotals(draft: PricingDraft, currency: string | null): QuotationTotals | null {
  if (!currency) return null;
  try {
    return computeQuotationTotals({
      method: draft.method,
      currency,
      statedAmount: num(draft.price),
      materialBaseAmount: num(draft.materialBaseAmount),
      percentageRate: num(draft.percentageRate),
      packageRate: num(draft.packageRate),
      packageQuantity: draft.packageBasis === 'fixed_project' ? 1 : num(draft.packageQuantity),
      lines: draft.lines
        .map(line => ({ quantity: num(line.quantity) ?? 0, rate: num(line.rate) ?? 0 }))
        .filter(line => line.quantity > 0),
      discountAmount: num(draft.discountAmount),
      contingencyRate: num(draft.contingencyRate),
      overheadRate: num(draft.overheadRate),
      vatRate: num(draft.vatRate),
    });
  } catch (error) {
    // An unknown currency scale. Showing nothing is right: a guessed rounding
    // is exactly what the shared module refuses to do.
    if (error instanceof UnknownCurrencyScaleError) return null;
    throw error;
  }
}

/** What the draft is still missing, in the reader's language. */
export function pricingErrors(draft: PricingDraft, ar: boolean): string[] {
  const errors: string[] = [];
  const need = (ok: boolean, en: string, arabic: string) => { if (!ok) errors.push(ar ? arabic : en); };
  if (draft.method === 'custom') {
    need((num(draft.price) ?? 0) > 0, 'Enter a valid price greater than zero.', 'أدخل سعراً صالحاً أكبر من صفر.');
  }
  if (draft.method === 'percentage') {
    need((num(draft.materialBaseAmount) ?? 0) > 0,
      'State the material cost the percentage applies to.', 'حدّد تكلفة المواد التي تُحسب عليها النسبة.');
    need((num(draft.percentageRate) ?? 0) > 0,
      'State the agreed percentage.', 'حدّد النسبة المتفق عليها.');
    need(Boolean(draft.percentageBasisNote.trim()),
      'Say which material values are in the base, and what is excluded.',
      'وضّح ما يدخل في أساس الحساب وما يُستثنى منه.');
  }
  if (draft.method === 'package') {
    need((num(draft.packageRate) ?? 0) > 0, 'State the package rate or fixed price.', 'حدّد سعر الباقة.');
    need(Boolean(draft.packageBasis) && draft.packageBasis !== 'quote_on_request',
      'State what the rate is charged on.', 'حدّد أساس تسعير الباقة.');
    need(draft.packageBasis === 'fixed_project' || (num(draft.packageQuantity) ?? 0) > 0,
      'State the area or quantity the rate applies to.', 'حدّد المساحة أو الكمية.');
  }
  if (draft.method === 'detailed') {
    const usable = draft.lines.filter(
      line => line.description.trim() && (num(line.quantity) ?? 0) > 0 && num(line.rate) !== null);
    need(usable.length > 0, 'Add at least one priced line.', 'أضف بنداً واحداً على الأقل بسعر.');
  }
  return errors;
}

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function QuotationPricingFields({
  draft, onChange, currency, ar, requestedPreference,
}: {
  draft: PricingDraft;
  onChange: (next: PricingDraft) => void;
  currency: string | null;
  ar: boolean;
  /** The method the customer asked for, if they stated one. */
  requestedPreference?: string | null;
}) {
  const lang = ar ? 'ar' : 'en';
  const set = <K extends keyof PricingDraft>(key: K) => (value: PricingDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const totals = useMemo(() => previewTotals(draft, currency), [draft, currency]);
  const money = (value: number | null | undefined) =>
    value == null ? '—' : (formatMoney(value, currency, lang) ?? String(value));

  /**
   * A STATED PREFERENCE IS A CONSTRAINT, and the server enforces it. Offering a
   * method the server will refuse is a form that wastes a contractor's work.
   */
  const constrained = isPricingPreference(requestedPreference ?? '')
    && requestedPreference !== 'provider_choice'
    ? (requestedPreference as PricingMethod)
    : null;
  const offered = constrained ? [constrained] : PRICING_METHODS;

  const setLine = (index: number, patch: Partial<DraftLine>) =>
    onChange({ ...draft, lines: draft.lines.map((line, i) => i === index ? { ...line, ...patch } : line) });

  return (
    <div className="space-y-4" data-testid="pricing-fields">
      {requestedPreference ? (
        <p className="rounded-lg border border-dashed p-2 text-xs text-muted-foreground"
          data-testid="pricing-requested-preference">
          {ar ? 'طلب العميل طريقة التسعير: ' : 'The customer asked to be priced by: '}
          <strong>{isPricingPreference(requestedPreference)
            ? pricingPreferenceLabel(requestedPreference, lang) : requestedPreference}</strong>
        </p>
      ) : null}

      {/* ── THE METHOD ─────────────────────────────────────────────────── */}
      <div>
        <span className="mb-2 block text-sm font-medium">
          {ar ? 'طريقة التسعير' : 'How are you pricing this?'}
        </span>
        <div className="flex flex-wrap gap-2" role="radiogroup"
          aria-label={ar ? 'طريقة التسعير' : 'Pricing method'}>
          {offered.map(method => (
            <Button
              key={method}
              type="button"
              role="radio"
              aria-checked={draft.method === method}
              variant={draft.method === method ? 'default' : 'outline'}
              size="sm"
              data-testid={`pricing-method-${method}`}
              onClick={() => set('method')(method)}
            >
              {PRICING_METHOD_LABELS[method][lang]}
            </Button>
          ))}
        </div>
      </div>

      {/* ── PERCENTAGE: نسبة من تكلفة المواد ──────────────────────────── */}
      {draft.method === 'percentage' && (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="pricing-percentage">
          <Row label={ar ? 'تكلفة المواد المعتمدة' : 'Applicable material cost'}
            hint={currency ?? undefined}>
            <Input type="number" min="0" step="0.001" data-testid="pricing-material-base"
              value={draft.materialBaseAmount}
              onChange={event => set('materialBaseAmount')(event.target.value)} />
          </Row>
          <Row label={ar ? 'النسبة المتفق عليها %' : 'Agreed percentage %'}>
            <Input type="number" min="0" step="0.001" data-testid="pricing-percentage-rate"
              value={draft.percentageRate}
              onChange={event => set('percentageRate')(event.target.value)} />
          </Row>
          <div className="sm:col-span-2">
            <Row
              label={ar ? 'ما يدخل في أساس الحساب وما يُستثنى' : 'What is in the base, and what is excluded'}
              /* REQUIRED, not optional. A percentage of a base nobody described
                 is not a price the customer can check. */
              hint={ar
                ? 'مطلوب: يحق للعميل معرفة قيم المواد التي تُحسب عليها النسبة.'
                : 'Required: the customer is entitled to know which material values the percentage is charged on.'}
            >
              <Textarea rows={3} maxLength={2000} data-testid="pricing-basis-note"
                value={draft.percentageBasisNote}
                onChange={event => set('percentageBasisNote')(event.target.value)} />
            </Row>
          </div>
        </div>
      )}

      {/* ── PACKAGE: باقة تشطيب ───────────────────────────────────────── */}
      {draft.method === 'package' && (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="pricing-package">
          <Row label={ar ? 'اسم الباقة' : 'Package name or tier'}
            /* Free text: the four suggestions are labels, not a closed set. */
            hint={ar ? 'يمكنك استخدام اسمك الخاص للباقة.' : 'Your own package name is fine.'}>
            <Input maxLength={60} data-testid="pricing-package-tier" list="package-tiers"
              value={draft.packageTier}
              onChange={event => set('packageTier')(event.target.value)} />
            <datalist id="package-tiers">
              {SUGGESTED_PACKAGE_TIERS.map(tier => (
                <option key={tier} value={PACKAGE_TIER_LABELS[tier][lang]} />
              ))}
            </datalist>
          </Row>
          <Row label={ar ? 'أساس التسعير' : 'Charged on'}>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              data-testid="pricing-package-basis"
              value={draft.packageBasis}
              onChange={event => set('packageBasis')(event.target.value as ServicePricingBasis | '')}
            >
              <option value="">{ar ? 'اختر…' : 'Choose…'}</option>
              {/* `quote_on_request` is deliberately absent: a package quotation
                  states a price, so "quote on request" is not a package basis. */}
              {SERVICE_PRICING_BASES.filter(basis => basis !== 'quote_on_request').map(basis => (
                <option key={basis} value={basis}>{pricingBasisLabel(basis, lang)}</option>
              ))}
            </select>
          </Row>
          <Row label={ar ? 'السعر' : 'Rate or fixed price'} hint={currency ?? undefined}>
            <Input type="number" min="0" step="0.001" data-testid="pricing-package-rate"
              value={draft.packageRate}
              onChange={event => set('packageRate')(event.target.value)} />
          </Row>
          {draft.packageBasis !== 'fixed_project' && (
            <Row label={ar ? 'المساحة أو الكمية' : 'Area or quantity'}>
              <Input type="number" min="0" step="0.01" data-testid="pricing-package-quantity"
                value={draft.packageQuantity}
                onChange={event => set('packageQuantity')(event.target.value)} />
            </Row>
          )}
        </div>
      )}

      {/* ── DETAILED / BOQ: تسعير تفصيلي ──────────────────────────────── */}
      {draft.method === 'detailed' && (
        <div className="space-y-2" data-testid="pricing-detailed">
          {draft.lines.map((line, index) => (
            <div key={index} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-12"
              data-testid="pricing-line">
              <div className="sm:col-span-4">
                <Input placeholder={ar ? 'وصف البند' : 'Description'} maxLength={255}
                  data-testid="pricing-line-description"
                  value={line.description}
                  onChange={event => setLine(index, { description: event.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  aria-label={ar ? 'نوع التكلفة' : 'Cost component'}
                  data-testid="pricing-line-component"
                  value={line.component}
                  onChange={event => setLine(index, { component: event.target.value as CostComponent })}
                >
                  {COST_COMPONENTS.map(component => (
                    <option key={component} value={component}>
                      {COST_COMPONENT_LABELS[component][lang]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <Input placeholder={ar ? 'الكمية' : 'Qty'} type="number" min="0" step="0.001"
                  data-testid="pricing-line-quantity"
                  value={line.quantity}
                  onChange={event => setLine(index, { quantity: event.target.value })} />
              </div>
              <div className="sm:col-span-1">
                <Input placeholder={ar ? 'وحدة' : 'Unit'} maxLength={40}
                  data-testid="pricing-line-unit"
                  value={line.unit}
                  onChange={event => setLine(index, { unit: event.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Input placeholder={ar ? 'سعر الوحدة' : 'Rate'} type="number" min="0" step="0.001"
                  data-testid="pricing-line-rate"
                  value={line.rate}
                  onChange={event => setLine(index, { rate: event.target.value })} />
              </div>
              <div className="flex items-center justify-end sm:col-span-1">
                <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0"
                  aria-label={ar ? 'حذف البند' : 'Remove line'}
                  data-testid="pricing-line-remove"
                  disabled={draft.lines.length === 1}
                  onClick={() => onChange({ ...draft, lines: draft.lines.filter((_, i) => i !== index) })}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="gap-1.5"
            data-testid="pricing-line-add"
            onClick={() => onChange({ ...draft, lines: [...draft.lines, { ...EMPTY_LINE }] })}>
            <Plus className="h-3.5 w-3.5" />{ar ? 'أضف بنداً' : 'Add a line'}
          </Button>
        </div>
      )}

      {/* ── CUSTOM: the pre-existing single figure ────────────────────── */}
      {draft.method === 'custom' && (
        <Row label={ar ? 'السعر' : 'Price'} hint={currency ?? undefined}>
          <Input type="number" min="0.01" step="0.001" data-testid="respond-price"
            value={draft.price} onChange={event => set('price')(event.target.value)} />
        </Row>
      )}

      {/* ── THE SHARED COMMERCIAL FIELDS, identical for all four ──────── */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Row label={ar ? 'خصم' : 'Discount'} hint={currency ?? undefined}>
          <Input type="number" min="0" step="0.001" data-testid="pricing-discount"
            value={draft.discountAmount}
            onChange={event => set('discountAmount')(event.target.value)} />
        </Row>
        <Row label={ar ? 'احتياطي %' : 'Contingency %'}>
          <Input type="number" min="0" max="100" step="0.001" data-testid="pricing-contingency"
            value={draft.contingencyRate}
            onChange={event => set('contingencyRate')(event.target.value)} />
        </Row>
        <Row label={ar ? 'مصاريف إدارية وربح %' : 'Overhead & profit %'}>
          <Input type="number" min="0" max="100" step="0.001" data-testid="pricing-overhead"
            value={draft.overheadRate}
            onChange={event => set('overheadRate')(event.target.value)} />
        </Row>
        <Row label={ar ? 'ضريبة القيمة المضافة %' : 'VAT %'}
          /* Leaving it blank is a real answer and a different one from 0. */
          hint={ar ? 'اتركه فارغاً إن لم تُحدد نسبة.' : 'Leave blank if you are not stating a rate.'}>
          <Input type="number" min="0" max="100" step="0.001" data-testid="pricing-vat"
            value={draft.vatRate}
            onChange={event => set('vatRate')(event.target.value)} />
        </Row>
      </div>

      {/* ── THE BREAKDOWN ─────────────────────────────────────────────── */}
      {totals && totals.base > 0 && (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm" data-testid="pricing-preview">
          <dl className="space-y-1">
            <div className="flex justify-between">
              <dt>{ar ? 'الأساس' : 'Base'}</dt>
              <dd data-testid="pricing-preview-base">{money(totals.base)}</dd>
            </div>
            {totals.discount > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <dt>{ar ? 'خصم' : 'Discount'}</dt><dd>−{money(totals.discount)}</dd>
              </div>
            )}
            {totals.contingency > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <dt>{ar ? 'احتياطي' : 'Contingency'}</dt><dd>{money(totals.contingency)}</dd>
              </div>
            )}
            {totals.overhead > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <dt>{ar ? 'مصاريف إدارية وربح' : 'Overhead & profit'}</dt><dd>{money(totals.overhead)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt>{ar ? 'الصافي قبل الضريبة' : 'Net before VAT'}</dt>
              <dd>{money(totals.netBeforeVat)}</dd>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <dt>{ar ? 'ضريبة القيمة المضافة' : 'VAT'}</dt>
              <dd data-testid="pricing-preview-vat">
                {/* UNSTATED IS NOT ZERO, and it does not render as zero. */}
                {totals.vatRate === null
                  ? <Badge variant="outline">{ar ? 'غير محددة' : 'Not stated'}</Badge>
                  : money(totals.vatAmount)}
              </dd>
            </div>
            <div className="flex justify-between border-t pt-1 font-semibold">
              <dt>{ar ? 'الإجمالي' : 'Total'}</dt>
              <dd data-testid="pricing-preview-total">{money(totals.total)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground" data-testid="pricing-preview-note">
            {ar
              ? 'حساب استرشادي بنفس معادلة الخادم. الإجمالي النهائي يُحسب على الخادم عند الإرسال.'
              : 'A preview, using the same formula as the server. The final total is calculated on the server when you submit.'}
          </p>
        </div>
      )}
    </div>
  );
}
