import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function VendorNameChangeRequest() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const utils = trpc.useUtils();
  const [field, setField] = useState<'companyName' | 'tradingName'>('companyName');
  const [requestedValue, setRequestedValue] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const { data: requests = [] } = trpc.profile.myVendorNameChanges.useQuery(undefined, { retry: false });
  const submitRequest = trpc.profile.requestVendorNameChange.useMutation({
    onSuccess: () => {
      setError(''); setNotice(ar ? 'تم إرسال طلب تغيير الاسم للمراجعة.' : 'Name change request submitted for review.');
      setRequestedValue(''); setReason('');
      void utils.profile.myVendorNameChanges.invalidate();
    },
    onError: mutationError => { setNotice(''); setError(mutationError.message); },
  });

  const status = (value: string) => {
    const labels: Record<string, string> = ar
      ? { pending: 'قيد الانتظار', under_review: 'قيد المراجعة', needs_information: 'معلومات إضافية مطلوبة', approved: 'معتمد', rejected: 'مرفوض' }
      : { pending: 'Pending', under_review: 'Under review', needs_information: 'Needs information', approved: 'Approved', rejected: 'Rejected' };
    return labels[value] ?? value;
  };

  return (
    <div className="space-y-5" data-testid="vendor-name-change">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label className="text-xs text-muted-foreground">{ar ? 'الحقل' : 'Field'}</label>
          <Select value={field} onValueChange={value => setField(value as typeof field)}>
            <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="companyName">{ar ? 'الاسم التجاري' : 'Company name'}</SelectItem>
              <SelectItem value="tradingName">{ar ? 'الاسم القانوني / التجاري' : 'Legal / trading name'}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">{ar ? 'الاسم المطلوب' : 'Requested name'}</label>
          <Input className="mt-1 h-9" maxLength={191} value={requestedValue} onChange={event => setRequestedValue(event.target.value)} />
        </div>
        <Button
          size="sm"
          disabled={requestedValue.trim().length === 0 || submitRequest.isPending}
          onClick={() => { setError(''); setNotice(''); submitRequest.mutate({ field, requestedValue: requestedValue.trim(), reason: reason.trim() || undefined }); }}
        >
          {ar ? 'طلب تغيير الاسم' : 'Request name change'}
        </Button>
      </div>
      <div>
        <label className="text-xs text-muted-foreground">{ar ? 'السبب' : 'Reason'}</label>
        <Input className="mt-1 h-9" maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {notice && <p className="text-sm text-emerald-700">{notice}</p>}

      <div>
        <p className="mb-2 text-sm font-medium">{ar ? 'طلباتي السابقة' : 'My requests'}</p>
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">{ar ? 'لا توجد طلبات بعد.' : 'No requests yet.'}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="p-2 text-start">{ar ? 'الحقل' : 'Field'}</th>
                  <th className="p-2 text-start">{ar ? 'من' : 'From'}</th>
                  <th className="p-2 text-start">{ar ? 'إلى' : 'To'}</th>
                  <th className="p-2 text-start">{ar ? 'الحالة' : 'Status'}</th>
                  <th className="p-2 text-start">{ar ? 'السبب' : 'Reason'}</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(request => (
                  <tr key={request.id} className="border-b last:border-0">
                    <td className="p-2">{request.field === 'companyName' ? (ar ? 'الاسم التجاري' : 'Company name') : (ar ? 'الاسم القانوني / التجاري' : 'Legal / trading name')}</td>
                    <td className="p-2 text-muted-foreground">{request.currentValue || '—'}</td>
                    <td className="p-2 font-medium">{request.requestedValue}</td>
                    <td className="p-2"><Badge variant="secondary">{status(request.status)}</Badge></td>
                    <td className="p-2 text-muted-foreground">{request.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
