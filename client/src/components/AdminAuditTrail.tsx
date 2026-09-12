import { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollText } from 'lucide-react';

/**
 * THE AUDIT TRAILS, ON A SCREEN.
 *
 * `audit.all` and `admin.fullAuditReport` were both built, both authorized, and
 * neither had a client caller: BuildHub recorded every commercial event and
 * every account event and then showed an administrator none of them outside a
 * single user's dialog. A trail nobody can read is a trail that answers no
 * question - which is the only reason to keep one.
 *
 * TWO TRAILS, SIDE BY SIDE AND NOT MERGED. `commercialAuditEvents` records what
 * happened to a RECORD - a quotation accepted, a placement booked - and always
 * names a row in the table its subjectType names. `userAccountAuditEvents`
 * records what happened to an ACCOUNT. Merging them into one feed would need a
 * shared subject that neither has, and the "subjectId: 0 names nothing" problem
 * the commercial guard already rejects once.
 */
export default function AdminAuditTrail() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const failedCopy = loadFailedCopy(ar);

  const commercial = trpc.audit.all.useQuery({ limit: 100 }, { retry: false });
  /**
   * PAGED, SEARCHED AND FILTERED ON THE SERVER.
   *
   * This screen used to receive the most recent 1,000 events as a bare array.
   * A search over a truncated set does not fail - it answers "no such event"
   * when the event is on row 1,001, with exactly the same confidence it answers
   * correctly, and the number that would have told an administrator otherwise
   * was never sent.
   */
  const [auditPage, setAuditPage] = useState(0);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditAction, setAuditAction] = useState('');
  // Debounced so a search is one request per pause, not one per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(auditSearch.trim()); setAuditPage(0); }, 300);
    return () => clearTimeout(timer);
  }, [auditSearch]);

  const accounts = trpc.admin.fullAuditReport.useQuery({
    page: auditPage,
    search: debouncedSearch || undefined,
    action: auditAction || undefined,
  }, { retry: false });
  const filterOptions = trpc.admin.auditFilterOptions.useQuery(undefined, { retry: false });
  const auditRows = accounts.data?.rows ?? [];
  const auditTotal = accounts.data?.total ?? 0;
  const auditPageSize = accounts.data?.pageSize ?? 25;
  const auditPages = Math.max(1, Math.ceil(auditTotal / auditPageSize));

  const when = (value: unknown) => (value ? new Date(String(value)).toLocaleString() : '—');

  return (
    <Card data-testid="admin-audit-trail">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="h-5 w-5" />
          {ar ? 'سجلات التدقيق' : 'Audit trails'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="commercial">
          <TabsList>
            <TabsTrigger value="commercial" data-testid="tab-audit-commercial">
              {ar ? 'السجلات التجارية' : 'Commercial'}
            </TabsTrigger>
            <TabsTrigger value="accounts" data-testid="tab-audit-accounts">
              {ar ? 'سجلات الحسابات' : 'Accounts'}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="commercial" className="pt-4">
            {commercial.isError ? (
              <LoadFailed {...failedCopy} onRetry={() => void commercial.refetch()} />
            ) : (commercial.data?.length ?? 0) === 0 ? (
              /* Zero events is a real answer on a platform with no activity yet. */
              <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground" data-testid="audit-commercial-empty">
                {commercial.isLoading
                  ? (ar ? 'جارٍ التحميل…' : 'Loading…')
                  : (ar ? 'لم يُسجَّل أي حدث تجاري بعد.' : 'No commercial event has been recorded yet.')}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm" data-testid="audit-commercial">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="p-2 text-start">{ar ? 'الموضوع' : 'Subject'}</th>
                      <th className="p-2 text-start">{ar ? 'الإجراء' : 'Action'}</th>
                      <th className="p-2 text-start">{ar ? 'التفاصيل' : 'Detail'}</th>
                      <th className="p-2 text-start">{ar ? 'التاريخ' : 'When'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(commercial.data ?? []).map((row: any) => (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="p-2 font-mono text-xs">{row.subjectType} #{row.subjectId}</td>
                        <td className="p-2"><Badge variant="outline">{row.action}</Badge></td>
                        <td className="p-2 max-w-[28rem] break-words text-xs text-muted-foreground">{row.detail ?? '—'}</td>
                        <td className="p-2 text-xs text-muted-foreground">{when(row.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {auditTotal > auditPageSize && (
              <div className="mt-3 flex items-center justify-between gap-2" data-testid="audit-pager">
                <Button
                  variant="outline" size="sm"
                  disabled={auditPage === 0}
                  onClick={() => setAuditPage(current => Math.max(0, current - 1))}
                  data-testid="audit-prev"
                >{ar ? 'السابق' : 'Previous'}</Button>
                <span className="text-xs text-muted-foreground" data-testid="audit-page-label">
                  {ar ? `صفحة ${auditPage + 1} من ${auditPages}` : `Page ${auditPage + 1} of ${auditPages}`}
                </span>
                <Button
                  variant="outline" size="sm"
                  disabled={auditPage + 1 >= auditPages}
                  onClick={() => setAuditPage(current => current + 1)}
                  data-testid="audit-next"
                >{ar ? 'التالي' : 'Next'}</Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="accounts" className="pt-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Input
                value={auditSearch}
                onChange={event => setAuditSearch(event.target.value)}
                placeholder={ar ? 'ابحث في الأحداث والأسماء والملاحظات…' : 'Search events, people and notes…'}
                className="h-9 max-w-xs"
                data-testid="audit-search"
              />
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={auditAction}
                onChange={event => { setAuditAction(event.target.value); setAuditPage(0); }}
                data-testid="audit-action-filter"
              >
                <option value="">{ar ? 'كل الإجراءات' : 'All actions'}</option>
                {(filterOptions.data?.actions ?? []).map(action => (
                  <option key={action} value={action}>{action}</option>
                ))}
              </select>
              {/* THE REAL TOTAL, which is the number that tells an administrator
                  whether their search found everything. */}
              <span className="text-xs text-muted-foreground" data-testid="audit-total">
                {ar ? `${auditTotal} حدثًا` : `${auditTotal} event${auditTotal === 1 ? '' : 's'}`}
              </span>
            </div>
            {accounts.isError ? (
              <LoadFailed {...failedCopy} onRetry={() => void accounts.refetch()} />
            ) : auditRows.length === 0 ? (
              <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground" data-testid="audit-accounts-empty">
                {accounts.isLoading
                  ? (ar ? 'جارٍ التحميل…' : 'Loading…')
                  : (debouncedSearch || auditAction)
                    /* "Nothing matches your search" and "nothing has happened"
                       are different facts, and an administrator who cannot tell
                       them apart will read a bad filter as a quiet platform. */
                    ? (ar ? 'لا نتائج مطابقة لهذا البحث.' : 'No event matches this search.')
                    : (ar ? 'لم يُسجَّل أي حدث على أي حساب بعد.' : 'No account event has been recorded yet.')}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm" data-testid="audit-accounts">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="p-2 text-start">{ar ? 'الحساب' : 'Account'}</th>
                      <th className="p-2 text-start">{ar ? 'الإجراء' : 'Action'}</th>
                      <th className="p-2 text-start">{ar ? 'من نفّذه' : 'By'}</th>
                      <th className="p-2 text-start">{ar ? 'ملاحظة' : 'Note'}</th>
                      <th className="p-2 text-start">{ar ? 'التاريخ' : 'When'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditRows.map((row) => (
                      <tr key={row.id} className="border-b last:border-0">
                        {/* A name, then the id - never the id alone. */}
                        <td className="p-2 text-xs">{row.userName ?? row.userEmail ?? (row.userId ? `#${row.userId}` : '—')}</td>
                        <td className="p-2"><Badge variant="outline">{row.action}</Badge></td>
                        <td className="p-2 text-xs text-muted-foreground">{row.actorName ?? '—'}</td>
                        <td className="p-2 max-w-[24rem] break-words text-xs text-muted-foreground">{row.note ?? '—'}</td>
                        <td className="p-2 text-xs text-muted-foreground">{when(row.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
