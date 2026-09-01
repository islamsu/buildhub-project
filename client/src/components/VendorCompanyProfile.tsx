import { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

/**
 * THE VENDOR'S OWN COMPANY RECORD.
 *
 * BuildHub's vendor profile was a personal name and a bio. A customer choosing
 * between two construction firms was choosing between two people's names, with
 * no company, no address, no registration, and no way to reach whoever
 * actually answers the phone.
 *
 * WHAT THE VENDOR IS TOLD ABOUT VISIBILITY, and why it is on the form rather
 * than in a help page: these fields are not equally public, and a vendor
 * typing their mobile number into a box deserves to know who will see it
 * BEFORE they save it, not after. Each group says so.
 *
 * Nothing here is pre-filled with invented values. An empty profile saves as
 * NULL and the public page says the vendor has not provided it.
 */
export default function VendorCompanyProfile() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.profile.myCompanyProfile.useQuery(undefined, { retry: false });

  const [form, setForm] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  // Seed once the server answers. Null columns become '' so the inputs are
  // controlled from the first render - React warns loudly otherwise, and a
  // field that flips from uncontrolled to controlled loses what was typed.
  useEffect(() => {
    if (!data) return;
    const seeded: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) seeded[key] = value == null ? '' : String(value);
    setForm(seeded);
  }, [data]);

  const save = trpc.profile.saveMyCompanyProfile.useMutation({
    onSuccess: () => {
      setError('');
      setSaved(ar ? 'تم حفظ بيانات الشركة.' : 'Company details saved.');
      void utils.profile.myCompanyProfile.invalidate();
    },
    onError: e => { setSaved(''); setError(e.message); },
  });

  const field = (name: string) => ({
    value: form[name] ?? '',
    onChange: (e: { target: { value: string } }) => {
      setSaved(''); setError('');
      setForm(prev => ({ ...prev, [name]: e.target.value }));
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">{ar ? 'جاري التحميل…' : 'Loading…'}</p>;

  const Group = ({ title, note, children }: { title: string; note: string; children: React.ReactNode }) => (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{note}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );

  const Field = ({ name, label }: { name: string; label: string }) => (
    <div>
      <label className="text-xs text-muted-foreground" htmlFor={`company-${name}`}>{label}</label>
      <Input id={`company-${name}`} data-testid={`company-${name}`} className="mt-1 h-9" {...field(name)} />
    </div>
  );

  const TextareaField = ({ name, label, rows = 3, maxLength = 5000 }: { name: string; label: string; rows?: number; maxLength?: number }) => (
    <div>
      <label className="text-xs text-muted-foreground" htmlFor={`company-${name}`}>{label}</label>
      <Textarea id={`company-${name}`} data-testid={`company-${name}`} className="mt-1" rows={rows} maxLength={maxLength} {...field(name)} />
    </div>
  );

  return (
    <div className="space-y-6" data-testid="vendor-company-form">
      <Group
        title={ar ? 'الشركة' : 'Company'}
        note={ar
          ? 'يظهر هذا لأي زائر في دليل الموردين — وهو ما يختار العميل على أساسه.'
          : 'Visible to anyone browsing the directory — this is what a customer chooses you on.'}
      >
        <Field name="companyName" label={ar ? 'الاسم التجاري' : 'Company name'} />
        <Field name="tradingName" label={ar ? 'الاسم القانوني / التجاري' : 'Legal / trading name'} />
        <Field name="website" label={ar ? 'الموقع الإلكتروني' : 'Website'} />
        <Field name="city" label={ar ? 'المدينة' : 'City'} />
        <Field name="country" label={ar ? 'الدولة' : 'Country'} />
      </Group>

      <div>
        <label className="text-xs text-muted-foreground" htmlFor="company-companyDescription">
          {ar ? 'وصف الشركة' : 'Company description'}
        </label>
        <Textarea
          id="company-companyDescription" data-testid="company-companyDescription"
          className="mt-1" rows={3} maxLength={5000} {...field('companyDescription')}
        />
      </div>

      <Group
        title={ar ? 'جهة الاتصال الرئيسية' : 'Primary contact'}
        note={ar
          ? 'لا يظهر هذا للجميع. يُكشف فقط للعميل بعد أن تتقدّم بعرض سعر على طلبه أو تنضم إلى مشروعه — وللمسؤولين.'
          : 'NOT public. Released to a customer only after you have quoted on their request or joined their project — and to administrators.'}
      >
        <Field name="primaryContactName" label={ar ? 'الاسم' : 'Name'} />
        <Field name="primaryContactPosition" label={ar ? 'المسمى الوظيفي' : 'Position'} />
        <Field name="primaryContactEmail" label={ar ? 'البريد الإلكتروني' : 'Email'} />
        <Field name="alternativeEmail" label={ar ? 'بريد بديل' : 'Alternative email'} />
        <Field name="primaryContactPhone" label={ar ? 'الهاتف' : 'Phone'} />
        <Field name="primaryContactMobile" label={ar ? 'الموبايل' : 'Mobile'} />
        <Field name="addressLine" label={ar ? 'العنوان' : 'Street address'} />
      </Group>

      <Group
        title={ar ? 'نطاق الخدمة والتخصصات' : 'Coverage & specialties'}
        note={ar
          ? 'يظهر هذا للجميع ويساعد العملاء على اكتشافك حسب المنطقة والتخصص.'
          : 'Visible to everyone; it helps customers discover you by area and specialism.'}
      >
        <TextareaField name="serviceCoverage" label={ar ? 'مناطق الخدمة' : 'Service coverage'} rows={2} />
        <TextareaField name="specialties" label={ar ? 'التخصصات' : 'Specialties'} rows={2} />
      </Group>

      <Group
        title={ar ? 'ساعات العمل والروابط' : 'Hours & links'}
        note={ar
          ? 'يظهر هذا للجميع. لا تضع أي روابط تحتوي على بيانات اعتماد أو كلمات سر.'
          : 'Visible to everyone. Do not put any credential or password in a link.'}
      >
        <TextareaField name="businessHours" label={ar ? 'ساعات العمل' : 'Business hours'} rows={2} maxLength={2000} />
        <TextareaField name="socialLinks" label={ar ? 'روابط العمل / التواصل' : 'Business / social links'} rows={3} />
      </Group>

      <Group
        title={ar ? 'السجل التجاري' : 'Commercial registration'}
        note={ar
          ? 'يظهر للمسؤولين فقط، ولا يظهر لأي عميل — لأنه الرقم الذي يحتاجه من ينتحل صفة شركتك.'
          : 'Administrators only, never shown to a customer — it is the number somebody impersonating your firm would need.'}
      >
        <Field name="registrationNumber" label={ar ? 'رقم السجل' : 'Registration number'} />
      </Group>

      <div className="flex items-center gap-3">
        <Button
          size="sm" data-testid="company-save"
          disabled={save.isPending}
          onClick={() => { setSaved(''); setError(''); save.mutate(form as never); }}
        >
          {ar ? 'حفظ' : 'Save'}
        </Button>
        {saved && <span className="text-sm text-emerald-700" data-testid="company-saved">{saved}</span>}
        {error && <span className="text-sm text-destructive" data-testid="company-error">{error}</span>}
      </div>
    </div>
  );
}
