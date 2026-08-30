/**
 * ── What is wrong with the data right now (Part 49) ────────────────────────
 *
 * Every number on this screen is a count of real rows returned by
 * server/admin/dataQuality.ts. There is no score, no percentage and no grade,
 * because there is no honest way to add "two duplicate accounts" to "nine stale
 * bids" and the resulting figure would be the most prominent thing on the page.
 *
 * A CHECK THAT FOUND NOTHING RENDERS "0", NOT A GREEN TICK. The reader is
 * looking at the question and its answer, which is what lets them notice a
 * question that is not being asked properly. A tick hides the question.
 *
 * A CHECK THAT COULD NOT RUN SAYS SO. `count: null` renders as "could not be
 * checked" in the destructive colour - never as zero, which would read as
 * "nothing wrong here" and is the one thing this screen must never say by
 * accident.
 *
 * SAMPLES ARE IDS. The server sends record ids and no field values; the
 * administrator looks the id up wherever they are already entitled to see it.
 */

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ClipboardList, AlertTriangle } from 'lucide-react';

/**
 * The question each check asks, in the words an operator would use.
 *
 * Keyed by the server's own key. A key with no entry here still renders - as
 * its raw key - rather than disappearing, because a check silently vanishing
 * from a data-quality screen is precisely the failure this page exists to
 * catch.
 */
const QUESTIONS: Record<string, { en: string; ar: string }> = {
  approved_provider_missing_required_document: {
    en: 'Approved to trade without an approved copy of a document their role requires',
    ar: 'معتمد للعمل دون وجود مستند مطلوب لفئته معتمَد',
  },
  rfq_open_past_deadline: {
    en: 'Requests still open and still collecting bids after their deadline',
    ar: 'طلبات ما زالت مفتوحة وتستقبل عروضاً بعد انتهاء موعدها',
  },
  quotation_pending_on_settled_rfq: {
    en: 'Bids still marked pending on a request that is already awarded or closed',
    ar: 'عروض ما زالت "قيد الانتظار" على طلب تمت ترسيته أو إغلاقه',
  },
  notification_link_target_missing: {
    en: 'Notifications whose link points at a record that no longer exists',
    ar: 'إشعارات يشير رابطها إلى سجل لم يعد موجوداً',
  },
  history_subject_missing: {
    en: 'Change-history rows describing a record that has been removed',
    ar: 'سجلات تغيير تصف سجلاً تم حذفه',
  },
  duplicate_account_email: {
    en: 'Accounts sharing one email address',
    ar: 'حسابات تتشارك بريداً إلكترونياً واحداً',
  },
  duplicate_account_phone: {
    en: 'Accounts sharing one phone number',
    ar: 'حسابات تتشارك رقم هاتف واحداً',
  },
  active_product_without_price: {
    en: 'Products on sale with no price a buyer can see',
    ar: 'منتجات معروضة للبيع بلا سعر ظاهر للمشتري',
  },
  active_product_of_frozen_supplier: {
    en: 'Live listings belonging to a frozen supplier account',
    ar: 'منتجات معروضة تخص حساب مورّد مجمَّد',
  },
};

const SEVERITY_LABEL: Record<string, { en: string; ar: string }> = {
  high: { en: 'High', ar: 'مرتفع' },
  medium: { en: 'Medium', ar: 'متوسط' },
  low: { en: 'Low', ar: 'منخفض' },
};

const SUBJECT_LABEL: Record<string, { en: string; ar: string }> = {
  user: { en: 'account ids', ar: 'أرقام حسابات' },
  rfq: { en: 'request ids', ar: 'أرقام طلبات' },
  quotation: { en: 'bid ids', ar: 'أرقام عروض' },
  product: { en: 'product ids', ar: 'أرقام منتجات' },
  notification: { en: 'notification ids', ar: 'أرقام إشعارات' },
  history: { en: 'history ids', ar: 'أرقام سجلات' },
};

export default function AdminDataQuality() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [includeDummy, setIncludeDummy] = useState(false);

  const { data, isLoading, error } = trpc.admin.dataQuality.useQuery({ includeDummy }, { retry: false });
  const text = (table: Record<string, { en: string; ar: string }>, key: string, fallback: string) =>
    table[key] ? (ar ? table[key].ar : table[key].en) : fallback;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="w-5 h-5" />
          {ar ? 'جودة البيانات' : 'Data quality'}
        </CardTitle>
        <p className="pt-2 text-sm text-muted-foreground">
          {ar
            ? 'كل رقم هنا هو عدد سجلات حقيقية مطابقة للسؤال المذكور. لا توجد نسبة ولا تقييم عام: لا معنى لجمع "حسابان مكرران" مع "تسعة عروض معلّقة".'
            : 'Every number here is a count of real rows matching the question beside it. There is no percentage and no overall grade: adding "two duplicate accounts" to "nine stale bids" would not mean anything.'}
        </p>
        <label className="flex items-center gap-2 pt-3 text-sm" data-testid="dq-dummy-toggle">
          <Switch checked={includeDummy} onCheckedChange={setIncludeDummy} />
          <span>{ar ? 'أدرج حسابات الاختبار' : 'Include QA test accounts'}</span>
        </label>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground">…</p>}

        {error && (
          <p className="flex items-start gap-2 text-sm text-destructive" data-testid="dq-error" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error.message}</span>
          </p>
        )}

        {data && (
          <div className="space-y-2" data-testid="dq-checks">
            {data.checks.map(check => (
              <div
                key={check.key}
                className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-start sm:justify-between"
                data-testid="dq-check"
                data-check={check.key}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {text(QUESTIONS, check.key, check.key)}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={check.severity === 'high' ? 'destructive' : 'outline'}>
                      {text(SEVERITY_LABEL, check.severity, check.severity)}
                    </Badge>
                    <code className="text-[11px]">{check.key}</code>
                  </p>
                  {check.sampleIds.length > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground" data-testid="dq-sample">
                      {text(SUBJECT_LABEL, check.subject, check.subject)}:{' '}
                      <span className="font-mono">{check.sampleIds.join(', ')}</span>
                      {check.count !== null && check.count > check.sampleIds.length && (
                        <span> {ar ? `(أول ${check.sampleIds.length} من ${check.count})` : `(first ${check.sampleIds.length} of ${check.count})`}</span>
                      )}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-end">
                  {check.count === null ? (
                    // NEVER rendered as zero. "The query failed" and "nothing is
                    // wrong" are opposite statements.
                    <span className="text-sm font-medium text-destructive" data-testid="dq-count">
                      {ar ? 'تعذّر الفحص' : 'could not be checked'}
                    </span>
                  ) : (
                    <span
                      className={`text-2xl font-semibold ${check.count > 0 ? 'text-destructive' : ''}`}
                      data-testid="dq-count"
                    >
                      {check.count}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
