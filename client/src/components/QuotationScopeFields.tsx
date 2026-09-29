/**
 * ── WHAT THE PRICE COVERS, WHICH IS THE ACTUAL COMMERCIAL QUESTION ──────
 *
 * Two bids for the same apartment, one 20% cheaper. Almost always the cheaper
 * one left something out - kitchen cabinets, the sanitary ware, the AC - and
 * before this there was nowhere to say so except a free-text "notes" field that
 * no comparison screen could read.
 *
 * So inclusions and exclusions are STRUCTURED, one item per line, because
 * `scopeDifferences` diffs them and reports three states: included here,
 * excluded there, and SILENT - which is neither, and is reported as its own
 * state rather than guessed either way.
 *
 * ── WHY EXCLUSIONS MATTER MORE THAN INCLUSIONS ──────────────────────────
 *
 * A contractor who lists what they are doing is being helpful. A contractor who
 * lists what they are NOT doing is being honest, and it is the second list that
 * a customer needs and never receives. It is given equal prominence here for
 * that reason, not for symmetry.
 */
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';

/** Free-text lists while they are being typed: one item per line. */
export type ScopeDraft = {
  inclusions: string;
  exclusions: string;
  allowances: string;
  upgrades: string;
  assumptions: string;
  milestones: string;
  specifications: string;
  materialLevel: string;
  includedTrades: string;
  laborIncluded: boolean | null;
};

export const EMPTY_SCOPE: ScopeDraft = {
  inclusions: '', exclusions: '', allowances: '', upgrades: '', assumptions: '',
  milestones: '', specifications: '', materialLevel: '', includedTrades: '',
  laborIncluded: null,
};

const lines = (value: string): string[] | undefined => {
  const list = value.split('\n').map(item => item.trim()).filter(Boolean).slice(0, 50);
  return list.length > 0 ? list : undefined;
};

/**
 * The `scope` object for `rfq.submitQuotation`, or undefined when nothing was
 * said.
 *
 * UNDEFINED RATHER THAN EMPTY ARRAYS. An empty inclusions list would read as
 * "this quotation includes nothing", which is a claim; saying nothing is not.
 */
export function scopePayload(draft: ScopeDraft) {
  const scope = {
    inclusions: lines(draft.inclusions),
    exclusions: lines(draft.exclusions),
    allowances: lines(draft.allowances),
    upgrades: lines(draft.upgrades),
    assumptions: lines(draft.assumptions),
    milestones: lines(draft.milestones),
    specifications: lines(draft.specifications),
    materialLevel: draft.materialLevel.trim() || undefined,
    includedTrades: lines(draft.includedTrades),
    laborIncluded: draft.laborIncluded ?? undefined,
  };
  return Object.values(scope).some(value => value !== undefined) ? scope : undefined;
}

function ListField({
  label, hint, value, onChange, testId,
}: {
  label: string; hint: string; value: string; onChange: (value: string) => void; testId: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <Textarea rows={3} value={value} data-testid={testId}
        onChange={event => onChange(event.target.value)} />
      <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
    </label>
  );
}

export function QuotationScopeFields({
  draft, onChange, ar,
}: { draft: ScopeDraft; onChange: (next: ScopeDraft) => void; ar: boolean }) {
  const set = <K extends keyof ScopeDraft>(key: K) => (value: ScopeDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const perLine = ar ? 'بند واحد في كل سطر.' : 'One item per line.';

  return (
    <div className="space-y-3" data-testid="scope-fields">
      <div className="grid gap-3 sm:grid-cols-2">
        <ListField
          label={ar ? 'المشمول في العرض' : 'What is included'}
          hint={perLine} testId="scope-inclusions"
          value={draft.inclusions} onChange={set('inclusions')} />
        <ListField
          /* EQUAL PROMINENCE, deliberately. This is the list a customer needs
             and the one they almost never get. */
          label={ar ? 'غير المشمول' : 'What is NOT included'}
          hint={ar ? `${perLine} هذه هي القائمة التي يحتاجها العميل أكثر من غيرها.`
            : `${perLine} This is the list the customer needs most.`}
          testId="scope-exclusions"
          value={draft.exclusions} onChange={set('exclusions')} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ListField
          label={ar ? 'مخصصات الخامات' : 'Material allowances'}
          hint={perLine} testId="scope-allowances"
          value={draft.allowances} onChange={set('allowances')} />
        <ListField
          label={ar ? 'إضافات اختيارية' : 'Optional upgrades'}
          hint={perLine} testId="scope-upgrades"
          value={draft.upgrades} onChange={set('upgrades')} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ListField
          label={ar ? 'الماركات والمواصفات' : 'Brands and specifications'}
          hint={perLine} testId="scope-specifications"
          value={draft.specifications} onChange={set('specifications')} />
        <ListField
          label={ar ? 'البنود المشمولة من الأعمال' : 'Trades included'}
          hint={perLine} testId="scope-trades"
          value={draft.includedTrades} onChange={set('includedTrades')} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ListField
          label={ar ? 'دفعات السداد' : 'Payment milestones'}
          hint={perLine} testId="scope-milestones"
          value={draft.milestones} onChange={set('milestones')} />
        <ListField
          label={ar ? 'الافتراضات والشروط' : 'Assumptions and conditions'}
          hint={perLine} testId="scope-assumptions"
          value={draft.assumptions} onChange={set('assumptions')} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            {ar ? 'مستوى الخامات' : 'Material level'}
          </span>
          <Input maxLength={80} value={draft.materialLevel} data-testid="scope-material-level"
            onChange={event => set('materialLevel')(event.target.value)} />
        </label>
        <label className="flex items-center gap-2 self-end pb-2">
          <Checkbox
            checked={draft.laborIncluded === true}
            data-testid="scope-labor-included"
            /* NAMED ON THE CONTROL ITSELF. The wrapping label element reads to
               a sighted user, but this renders as a role="checkbox" button and
               a screen reader announces it as an unnamed "button" without this.
               (No angle brackets in here: the attribute scanner stops at the
               first one and would never reach the line below.) */
            aria-label={ar ? 'العمالة مشمولة في السعر' : 'Labour is included in the price'}
            onCheckedChange={checked => set('laborIncluded')(checked === true ? true : null)}
          />
          <span className="text-sm">{ar ? 'العمالة مشمولة في السعر' : 'Labour is included in the price'}</span>
        </label>
      </div>
    </div>
  );
}
