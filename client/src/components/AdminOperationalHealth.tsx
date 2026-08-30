/**
 * ── Is this deployment working? (Part 50) ──────────────────────────────────
 *
 * THE MOST IMPORTANT THING ON THIS SCREEN IS THE AMBER. SMTP and object storage
 * are genuinely unset on this project's staging environment, and a dashboard
 * that showed them green would be the exact fabricated assurance the whole
 * audit exists to prevent. Unconfigured renders as NOT CONFIGURED, in amber,
 * with a sentence naming what stops working - never as a tick, never hidden.
 *
 * The server sends a BOOLEAN per dependency and nothing else. There is no host,
 * bucket, region, key or URL in the payload to render even if this file wanted
 * to, which is where that guarantee actually lives.
 *
 * WHAT THIS SCREEN DOES NOT KNOW IS PRINTED ON IT. Uptime, error rate, latency,
 * throughput and queue depth are not persisted anywhere in BuildHub. Listing
 * them as unmeasured sends the reader to look somewhere else; inventing
 * plausible numbers would stop them looking.
 */

import { trpc } from '@/lib/trpc';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, AlertTriangle } from 'lucide-react';

const DEPENDENCY_LABEL: Record<string, { en: string; ar: string }> = {
  smtp: { en: 'Outbound email (SMTP)', ar: 'البريد الصادر (SMTP)' },
  objectStorage: { en: 'Object storage', ar: 'تخزين الملفات' },
  ai: { en: 'AI assistant', ar: 'المساعد الذكي' },
};

const AFFECTS: Record<string, { en: string; ar: string }> = {
  smtp: { en: 'password reset and outbound email', ar: 'استعادة كلمة المرور والبريد الصادر' },
  objectStorage: { en: 'document upload, attachments and product images', ar: 'رفع المستندات والمرفقات وصور المنتجات' },
  ai: { en: 'the AI assistant', ar: 'المساعد الذكي' },
};

const VOLUME_LABEL: Record<string, { en: string; ar: string }> = {
  users: { en: 'Accounts', ar: 'الحسابات' },
  rfqs: { en: 'Requests', ar: 'الطلبات' },
  quotations: { en: 'Bids', ar: 'العروض' },
  products: { en: 'Products', ar: 'المنتجات' },
  projects: { en: 'Projects', ar: 'المشاريع' },
};

const BACKLOG_LABEL: Record<string, { en: string; ar: string }> = {
  unreadNotifications: { en: 'Unread notifications', ar: 'إشعارات غير مقروءة' },
  openDisputes: { en: 'Open disputes', ar: 'نزاعات مفتوحة' },
  complianceQueue: { en: 'Registrations under review', ar: 'تسجيلات قيد المراجعة' },
  pendingQuotations: { en: 'Bids awaiting an answer', ar: 'عروض تنتظر رداً' },
  frozenAccounts: { en: 'Frozen accounts', ar: 'حسابات مجمَّدة' },
};

const NOT_MEASURED_LABEL: Record<string, { en: string; ar: string }> = {
  uptime: { en: 'uptime', ar: 'زمن التشغيل' },
  request_error_rate: { en: 'request error rate', ar: 'معدل أخطاء الطلبات' },
  request_latency: { en: 'request latency', ar: 'زمن استجابة الطلبات' },
  throughput: { en: 'throughput', ar: 'معدل المرور' },
  background_queue_depth: { en: 'background queue depth', ar: 'طول طابور المهام' },
};

export default function AdminOperationalHealth() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const { data, isLoading, error } = trpc.admin.operationalHealth.useQuery(undefined, { retry: false });

  const text = (table: Record<string, { en: string; ar: string }>, key: string, fallback: string) =>
    table[key] ? (ar ? table[key].ar : table[key].en) : fallback;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="w-5 h-5" />
          {ar ? 'حالة التشغيل' : 'Operational health'}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">
        {isLoading && <p className="text-sm text-muted-foreground">…</p>}

        {error && (
          <p className="flex items-start gap-2 text-sm text-destructive" data-testid="oh-error" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error.message}</span>
          </p>
        )}

        {data && (
          <div className="space-y-6" data-testid="oh-result">
            <div className="grid gap-3 sm:grid-cols-3">
              <Figure
                testid="oh-commit"
                label={ar ? 'النسخة المنشورة' : 'Deployed build'}
                value={data.commit}
                note={data.commit === 'unknown'
                  ? (ar ? 'هذه النسخة لا تعرف رقم إصدارها' : 'this build cannot say which commit it is')
                  : null}
              />
              <Figure
                testid="oh-database"
                label={ar ? 'قاعدة البيانات' : 'Database'}
                value={data.database.reachable ? (ar ? 'متصلة' : 'reachable') : (ar ? 'غير متصلة' : 'unreachable')}
                note={data.database.probeMs === null ? null : `${data.database.probeMs} ms`}
                bad={!data.database.reachable}
              />
              <Figure
                testid="oh-migrations"
                label={ar ? 'الترحيلات' : 'Migrations'}
                value={data.migrations.recorded === null
                  ? (ar ? 'غير مسجَّلة' : 'not recorded')
                  : `${data.migrations.recorded} / ${data.migrations.expected ?? '?'}`}
                note={data.migrations.atHead === null
                  ? (ar ? 'لا يمكن تأكيد أن القاعدة محدَّثة' : 'cannot be confirmed either way')
                  : data.migrations.atHead
                    ? (ar ? 'محدَّثة' : 'at head')
                    : (ar ? 'متأخرة عن هذه النسخة' : 'behind this build')}
                bad={data.migrations.atHead === false}
              />
            </div>

            {/* THE AMBER. See the file comment. */}
            <section className="rounded-xl border" data-testid="oh-dependencies">
              <p className="p-3 text-sm font-medium">{ar ? 'الاعتماديات' : 'Dependencies'}</p>
              {data.dependencies.map(dependency => (
                <div
                  key={dependency.key}
                  className="flex flex-wrap items-center justify-between gap-2 border-t p-3 text-sm"
                  data-testid="oh-dependency"
                  data-dependency={dependency.key}
                  data-configured={dependency.configured ? 'yes' : 'no'}
                >
                  <span>{text(DEPENDENCY_LABEL, dependency.key, dependency.key)}</span>
                  {dependency.configured ? (
                    <Badge variant="secondary">{ar ? 'مُهيّأة' : 'Configured'}</Badge>
                  ) : (
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge className="border-amber-300 bg-amber-50 text-amber-800">
                        {ar ? 'غير مُهيّأة' : 'NOT CONFIGURED'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {ar ? 'يتوقف بسببها: ' : 'this stops: '}
                        {text(AFFECTS, dependency.key, dependency.affects)}
                      </span>
                    </span>
                  )}
                </div>
              ))}
            </section>

            <Counts
              testid="oh-volumes"
              title={ar ? 'حجم البيانات' : 'What is in the database'}
              labels={VOLUME_LABEL}
              values={data.volumes}
              ar={ar}
            />
            <Counts
              testid="oh-backlogs"
              title={ar ? 'ما ينتظر معالجة' : 'What is waiting for someone'}
              labels={BACKLOG_LABEL}
              values={data.backlogs}
              ar={ar}
            />

            <section className="rounded-xl border border-dashed p-3" data-testid="oh-not-measured">
              <p className="text-sm font-medium">{ar ? 'ما لا تقيسه هذه الشاشة' : 'What this screen does not measure'}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {ar
                  ? 'لا تُخزَّن هذه القيم في BuildHub، وعرض رقم لها هنا سيكون اختلاقاً: '
                  : 'BuildHub does not store any of these, and showing a number for them here would be inventing it: '}
                {data.notMeasured.map(key => text(NOT_MEASURED_LABEL, key, key)).join(ar ? '، ' : ', ')}.
              </p>
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Counts({ testid, title, labels, values, ar }: {
  testid: string;
  title: string;
  labels: Record<string, { en: string; ar: string }>;
  values: Record<string, number>;
  ar: boolean;
}) {
  const entries = Object.entries(values);
  return (
    <section data-testid={testid}>
      <p className="mb-2 text-sm font-medium">{title}</p>
      {entries.length === 0 ? (
        // Not "0" for everything: the database was unreachable, and an empty
        // platform is a different statement from an unanswered question.
        <p className="text-sm text-muted-foreground">{ar ? 'تعذّر القياس' : 'could not be counted'}</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-5">
          {entries.map(([key, value]) => (
            <div key={key} className="rounded-xl border p-3" data-testid={`${testid}-item`} data-key={key}>
              <p className="text-xs text-muted-foreground">
                {labels[key] ? (ar ? labels[key].ar : labels[key].en) : key}
              </p>
              <p className="mt-1 text-xl font-semibold">{value}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Figure({ testid, label, value, note, bad }: {
  testid: string; label: string; value: string; note?: string | null; bad?: boolean;
}) {
  return (
    <div className="rounded-xl border p-3" data-testid={testid}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate font-semibold ${bad ? 'text-destructive' : ''}`} data-testid={`${testid}-value`}>{value}</p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
