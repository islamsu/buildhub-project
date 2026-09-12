import { useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import VendorIdentitySelect from '@/components/VendorIdentitySelect';
import { Link } from 'wouter';
import { Search, UserRound } from 'lucide-react';
import { Pager } from '@/components/Pager';

const NAME_CHANGE_PAGE_SIZE = 25;

export default function AdminVendorNameChanges() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const utils = trpc.useUtils();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'under_review' | 'needs_information' | 'approved' | 'rejected'>('all');
  const [reviewNote, setReviewNote] = useState('');
  const [correctionVendorId, setCorrectionVendorId] = useState<number | null>(null);
  const [correctionField, setCorrectionField] = useState<'companyName' | 'tradingName'>('companyName');
  const [correctionValue, setCorrectionValue] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const [page, setPage] = useState(0);
  /* Both filters run in the query now: they filtered a `.limit(250)` array. */
  const list = trpc.admin.vendorNameChanges.useQuery(
    { page, pageSize: NAME_CHANGE_PAGE_SIZE, search: query || undefined, status: statusFilter },
    { retry: false, placeholderData: previous => previous },
  );
  const requests = (list.data?.rows ?? []) as any[];
  const review = trpc.admin.reviewVendorNameChange.useMutation({
    onSuccess: () => {
      setError(''); setNotice(ar ? 'تم تحديث الطلب.' : 'Request updated.');
      setReviewNote('');
      void utils.admin.vendorNameChanges.invalidate();
    },
    onError: mutationError => { setNotice(''); setError(mutationError.message); },
  });
  const directCorrection = trpc.admin.directVendorNameCorrection.useMutation({
    onSuccess: () => {
      setError(''); setNotice(ar ? 'تم تصحيح الاسم.' : 'Name corrected.');
      setCorrectionVendorId(null); setCorrectionValue(''); setCorrectionReason('');
      void utils.admin.vendorNameChanges.invalidate();
    },
    onError: mutationError => { setNotice(''); setError(mutationError.message); },
  });

  // The server filters now; this is the page it returned.
  const filtered = requests;

  const status = (value: string) => {
    const labels: Record<string, string> = ar
      ? { pending: 'قيد الانتظار', under_review: 'قيد المراجعة', needs_information: 'معلومات إضافية مطلوبة', approved: 'معتمد', rejected: 'مرفوض' }
      : { pending: 'Pending', under_review: 'Under review', needs_information: 'Needs information', approved: 'Approved', rejected: 'Rejected' };
    return labels[value] ?? value;
  };

  return (
    <div className="space-y-6" data-testid="admin-vendor-name-changes">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="h-5 w-5" />
            {ar ? 'تصحيح مباشر لاسم المورّد' : 'Direct vendor name correction'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <VendorIdentitySelect
            value={correctionVendorId}
            onChange={setCorrectionVendorId}
            label={ar ? 'المورّد' : 'Vendor'}
            testId="admin-vendor-correction-vendor"
          />
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <Select value={correctionField} onValueChange={value => setCorrectionField(value as typeof correctionField)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="companyName">{ar ? 'الاسم التجاري' : 'Company name'}</SelectItem>
                <SelectItem value="tradingName">{ar ? 'الاسم القانوني / التجاري' : 'Legal / trading name'}</SelectItem>
              </SelectContent>
            </Select>
            <Input className="h-9" maxLength={191} value={correctionValue} onChange={event => setCorrectionValue(event.target.value)} placeholder={ar ? 'الاسم الجديد' : 'New name'} />
            <Input className="h-9" maxLength={1000} value={correctionReason} onChange={event => setCorrectionReason(event.target.value)} placeholder={ar ? 'السبب (مطلوب)' : 'Reason (required)'} />
            <Button
              size="sm"
              disabled={correctionVendorId === null || correctionValue.trim().length === 0 || correctionReason.trim().length === 0 || directCorrection.isPending}
              onClick={() => directCorrection.mutate({ userId: correctionVendorId!, field: correctionField, requestedValue: correctionValue.trim(), reason: correctionReason.trim() })}
            >
              {ar ? 'تصحيح' : 'Correct'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            {ar ? 'طلبات تغيير الأسماء' : 'Name change requests'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_170px_260px]">
            <Input value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder={ar ? 'ابحث بالمورّد أو الاسم…' : 'Search vendor or name…'} />
            <Select value={statusFilter} onValueChange={value => { setStatusFilter(value as typeof statusFilter); setPage(0); }}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{ar ? 'كل الحالات' : 'All statuses'}</SelectItem>
                <SelectItem value="pending">{status('pending')}</SelectItem>
                <SelectItem value="under_review">{status('under_review')}</SelectItem>
                <SelectItem value="needs_information">{status('needs_information')}</SelectItem>
                <SelectItem value="approved">{status('approved')}</SelectItem>
                <SelectItem value="rejected">{status('rejected')}</SelectItem>
              </SelectContent>
            </Select>
            <Input value={reviewNote} onChange={event => setReviewNote(event.target.value)} placeholder={ar ? 'ملاحظة المراجعة (اختياري)' : 'Review note (optional)'} />
          </div>

          {notice && <p className="text-sm text-emerald-700">{notice}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}

          {filtered.length === 0 ? (
            <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
              {ar ? 'لا توجد طلبات مطابقة.' : 'No matching requests.'}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="p-2 text-start">{ar ? 'المورّد' : 'Vendor'}</th>
                    <th className="p-2 text-start">{ar ? 'الحقل' : 'Field'}</th>
                    <th className="p-2 text-start">{ar ? 'من' : 'From'}</th>
                    <th className="p-2 text-start">{ar ? 'إلى' : 'To'}</th>
                    <th className="p-2 text-start">{ar ? 'الحالة' : 'Status'}</th>
                    <th className="p-2 text-start">{ar ? 'السبب' : 'Reason'}</th>
                    <th className="p-2 text-start">{ar ? 'إجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(request => (
                    <tr key={request.id} className="border-b last:border-0">
                      <td className="p-2">
                        <Link href={`/admin/users/${request.userId}`} className="font-medium underline-offset-2 hover:underline">
                          {request.userName || request.companyName || `#${request.userId}`}
                        </Link>
                        {request.userEmail && <p className="text-xs text-muted-foreground">{request.userEmail}</p>}
                      </td>
                      <td className="p-2 text-muted-foreground">{request.field === 'companyName' ? (ar ? 'الاسم التجاري' : 'Company name') : (ar ? 'الاسم القانوني / التجاري' : 'Legal / trading name')}</td>
                      <td className="p-2 text-muted-foreground">{request.currentValue || '—'}</td>
                      <td className="p-2 font-medium">{request.requestedValue}</td>
                      <td className="p-2"><Badge variant="secondary">{status(request.status)}</Badge></td>
                      <td className="p-2 text-muted-foreground">{request.reason || '—'}</td>
                      <td className="p-2">
                        {!['approved', 'rejected'].includes(request.status) && (
                          <div className="flex flex-wrap gap-1">
                            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={review.isPending} onClick={() => review.mutate({ requestId: request.id, status: 'approved', reviewerNote: reviewNote.trim() || undefined })}>{ar ? 'اعتماد' : 'Approve'}</Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={review.isPending} onClick={() => review.mutate({ requestId: request.id, status: 'needs_information', reviewerNote: reviewNote.trim() || undefined })}>{ar ? 'طلب معلومات' : 'Need info'}</Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" disabled={review.isPending} onClick={() => review.mutate({ requestId: request.id, status: 'rejected', reviewerNote: reviewNote.trim() || undefined })}>{ar ? 'رفض' : 'Reject'}</Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
  
        <Pager
          ar={ar} page={page} total={list.data?.total ?? null}
          pageCount={Math.max(1, Math.ceil((list.data?.total ?? 0) / NAME_CHANGE_PAGE_SIZE))}
          onChange={setPage} testId="admin-name-changes-pager"
        />
      </CardContent>
      </Card>
    </div>
  );
}
