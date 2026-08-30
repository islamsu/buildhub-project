/**
 * ── Listing a product, and changing one (§21–§25) ─────────────────────────
 *
 * Creating a product was an inline block inside the supplier's workspace;
 * editing one was a dialog in the catalogue. Neither had an address, so neither
 * could be linked to, bookmarked, returned to after a refresh, or reached from
 * a notification - and the two collected DIFFERENT fields, which is how origin
 * ended up accepted by the API and offered by nothing.
 *
 * ONE FORM, TWO ADDRESSES. `/products/new` and `/products/:id/edit` render this
 * same component, so a field cannot exist on one and be missing from the other.
 *
 * OWNERSHIP IS THE SERVER'S. This page loads the product through
 * `marketplace.myProducts`, which is scoped to the caller, and every save goes
 * through `updateProduct`, whose UPDATE carries `supplierId = ctx.user.id` in
 * its predicate. Pasting another supplier's product id into the URL gets the
 * server's refusal, not a form. Nothing here is the security boundary.
 *
 * ORIGIN AND UNIT are collected here for the first time - origin because the
 * column existed with no way to fill it, and unit as a SELECT because free text
 * had already produced sixteen products per "tonne" and three per "ton".
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PRODUCT_CATEGORIES, isProductCategory } from '@shared/productCategories';
import { PRODUCT_UNITS, isProductUnit } from '@shared/productUnits';
import { toast } from 'sonner';
import { ArrowLeft, PackagePlus, Save, AlertTriangle } from 'lucide-react';

type FormState = {
  name: string; nameAr: string; category: string; brand: string; origin: string;
  price: string; stock: string; unit: string; deliveryDays: string; description: string;
};

const EMPTY: FormState = {
  name: '', nameAr: '', category: '', brand: '', origin: '',
  price: '', stock: '', unit: '', deliveryDays: '', description: '',
};

export default function ProductFormPage({ mode, productId: productIdProp }: {
  mode: 'create' | 'edit';
  /** Supplied by the route wrapper, which reads the `:id` it declares. */
  productId?: number;
}) {
  const [, navigate] = useLocation();
  const { lang, dir } = useLanguage();
  const ar = lang === 'ar';
  const { isAuthenticated } = useAuth();

  const productId = mode === 'edit' ? (productIdProp ?? NaN) : null;
  const editing = mode === 'edit';
  const validId = !editing || (Number.isInteger(productId) && (productId ?? 0) > 0);

  // Self-scoped by construction: myProducts returns only this supplier's rows,
  // so a product that is not theirs is simply not in the list.
  const mine = trpc.marketplace.myProducts.useQuery(undefined, {
    enabled: isAuthenticated && editing && validId,
    retry: false,
  });
  const product = useMemo(
    () => mine.data?.find(row => row.id === productId) ?? null,
    [mine.data, productId],
  );

  const [form, setForm] = useState<FormState>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!editing || !product || loaded) return;
    setForm({
      name: product.name ?? '',
      nameAr: product.nameAr ?? '',
      category: product.category ?? '',
      brand: product.brand ?? '',
      origin: product.origin ?? '',
      price: product.price != null ? String(product.price) : '',
      stock: product.stock != null ? String(product.stock) : '',
      unit: product.unit ?? '',
      deliveryDays: product.deliveryDays != null ? String(product.deliveryDays) : '',
      description: product.description ?? '',
    });
    setLoaded(true);
  }, [editing, product, loaded]);

  const utils = trpc.useUtils();
  const done = (message: string) => {
    toast.success(message);
    void utils.marketplace.myProducts.invalidate();
    navigate('/platform/supplier#role-catalogue');
  };

  const create = trpc.marketplace.create.useMutation({
    onSuccess: () => done(ar ? 'تمت إضافة المنتج' : 'Product listed'),
    onError: error => toast.error(error.message),
  });
  const update = trpc.marketplace.updateProduct.useMutation({
    onSuccess: () => done(ar ? 'تم حفظ المنتج' : 'Product saved'),
    onError: error => toast.error(error.message),
  });

  const pending = create.isPending || update.isPending;
  const set = (key: keyof FormState) => (value: string) => setForm(f => ({ ...f, [key]: value }));

  /**
   * The unit already on the record, when it predates the shared list. Offered
   * as an extra option so a supplier editing an old product is not silently
   * switched to something else - and so saving the price does not fail on a
   * field they never touched.
   */
  const legacyUnit = editing && form.unit && !isProductUnit(form.unit) ? form.unit : null;

  const submit = () => {
    if (!isProductCategory(form.category)) {
      toast.error(ar ? 'اختر فئة من القائمة' : 'Choose a category from the list');
      return;
    }
    const common = {
      nameAr: form.nameAr || undefined,
      description: form.description || undefined,
      brand: form.brand || undefined,
      origin: form.origin || undefined,
      price: form.price ? Number(form.price) : undefined,
      stock: form.stock ? Number(form.stock) : undefined,
      unit: form.unit || undefined,
      deliveryDays: form.deliveryDays ? Number(form.deliveryDays) : undefined,
    };
    if (editing && productId) update.mutate({ id: productId, name: form.name, category: form.category, ...common });
    else create.mutate({ name: form.name, category: form.category, ...common });
  };

  if (!validId) {
    return <Shell dir={dir}><Refusal ar={ar} message={ar ? 'رقم منتج غير صالح.' : 'That is not a valid product number.'} /></Shell>;
  }

  // The product is not in this supplier's own list. Stated as not found rather
  // than "forbidden", the same answer the server gives, so the page does not
  // confirm that somebody else's id exists.
  if (editing && mine.isFetched && !product) {
    return (
      <Shell dir={dir}>
        <Refusal
          ar={ar}
          testid="product-form-denied"
          message={ar ? 'لم يُعثر على هذا المنتج في كتالوجك.' : 'That product is not in your catalogue.'}
        />
      </Shell>
    );
  }

  return (
    <Shell dir={dir}>
      <div className="mb-4">
        <Link href="/platform/supplier#role-catalogue">
          <Button variant="ghost" size="sm" className="gap-2" data-testid="product-form-back">
            <ArrowLeft className={`h-4 w-4 ${ar ? 'rotate-180' : ''}`} />
            {ar ? 'الكتالوج' : 'Catalogue'}
          </Button>
        </Link>
      </div>

      <Card data-testid="product-form">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {editing ? <Save className="h-5 w-5" /> : <PackagePlus className="h-5 w-5" />}
            {editing ? (ar ? 'تعديل المنتج' : 'Edit product') : (ar ? 'إضافة منتج جديد' : 'New product listing')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label={ar ? 'اسم المنتج' : 'Product name'} required>
            <Input data-testid="product-name" value={form.name} onChange={e => set('name')(e.target.value)} />
          </Field>
          <Field label={ar ? 'الاسم بالعربية' : 'Arabic name'}>
            <Input data-testid="product-name-ar" value={form.nameAr} onChange={e => set('nameAr')(e.target.value)} />
          </Field>

          <Field label={ar ? 'الفئة' : 'Category'} required>
            <select
              data-testid="product-category"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={form.category}
              onChange={e => set('category')(e.target.value)}
            >
              <option value="">{ar ? 'اختر الفئة' : 'Choose a category'}</option>
              {PRODUCT_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
            </select>
          </Field>

          <Field label={ar ? 'العلامة التجارية' : 'Brand'}>
            <Input data-testid="product-brand" value={form.brand} onChange={e => set('brand')(e.target.value)} />
          </Field>

          {/* THE FIELD THAT HAD NOWHERE TO BE ENTERED. */}
          <Field label={ar ? 'بلد المنشأ' : 'Country of origin'}>
            <Input
              data-testid="product-origin"
              placeholder={ar ? 'مثال: مصر، إيطاليا' : 'e.g. Egypt, Italy'}
              value={form.origin}
              onChange={e => set('origin')(e.target.value)}
            />
          </Field>

          <Field label={ar ? 'الوحدة' : 'Unit'}>
            <select
              data-testid="product-unit"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={form.unit}
              onChange={e => set('unit')(e.target.value)}
            >
              <option value="">{ar ? 'اختر الوحدة' : 'Choose a unit'}</option>
              {PRODUCT_UNITS.map(unit => <option key={unit} value={unit}>{unit}</option>)}
              {/* Kept so an older product's unit is not silently rewritten. */}
              {legacyUnit && (
                <option value={legacyUnit}>
                  {legacyUnit} {ar ? '(القيمة الحالية)' : '(current value)'}
                </option>
              )}
            </select>
          </Field>

          <Field label={ar ? 'السعر بالجنيه' : 'Price (EGP)'}>
            <Input data-testid="product-price" type="number" min={0} value={form.price} onChange={e => set('price')(e.target.value)} />
          </Field>
          <Field label={ar ? 'المخزون' : 'Stock'}>
            <Input data-testid="product-stock" type="number" min={0} value={form.stock} onChange={e => set('stock')(e.target.value)} />
          </Field>
          <Field label={ar ? 'أيام التوصيل' : 'Delivery days'}>
            <Input data-testid="product-delivery" type="number" min={1} value={form.deliveryDays} onChange={e => set('deliveryDays')(e.target.value)} />
          </Field>

          <div className="sm:col-span-2">
            <Field label={ar ? 'وصف المنتج' : 'Description'}>
              <Textarea data-testid="product-description" rows={4} value={form.description} onChange={e => set('description')(e.target.value)} />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Button
              className="w-full gap-2"
              data-testid="product-save"
              disabled={pending || !form.name || !form.category}
              onClick={submit}
            >
              {editing ? <Save className="h-4 w-4" /> : <PackagePlus className="h-4 w-4" />}
              {pending ? '…' : editing ? (ar ? 'حفظ التغييرات' : 'Save changes') : (ar ? 'أضف المنتج' : 'List product')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </Shell>
  );
}

function Shell({ dir, children }: { dir: string; children: React.ReactNode }) {
  return <DashboardLayout><div dir={dir} className="mx-auto max-w-3xl">{children}</div></DashboardLayout>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}{required && <span className="text-destructive"> *</span>}
      </span>
      {children}
    </label>
  );
}

function Refusal({ ar, message, testid }: { ar: boolean; message: string; testid?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="flex items-start gap-2 text-sm text-destructive" role="alert" data-testid={testid}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{message}</span>
        </p>
        <Link href="/platform/supplier#role-catalogue">
          <Button variant="outline" className="mt-4">{ar ? 'الكتالوج' : 'Catalogue'}</Button>
        </Link>
      </CardContent>
    </Card>
  );
}
