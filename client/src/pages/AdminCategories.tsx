// ── /admin/categories ──────────────────────────────────────────────────────
//
// The product taxonomy, administered.
//
// WHY THIS PAGE EXISTS. Bulk Product Upload refused "Waterproofing" and "Pools"
// for categories BuildHub already had, because the taxonomy was a frozen code
// constant: adding a category needed a deployment, and nobody outside
// engineering could do it at all. This is the surface that makes the taxonomy
// the product's own data.
//
// WHAT THE SCREEN PROMISES, AND WHAT THE SERVER ACTUALLY ENFORCES
//
//   The counts are REAL, from the products table - never estimated, never a
//   placeholder. A category showing "0 products" holds none.
//
//   Hiding a category NEVER moves a product. The confirmation says so and the
//   server does it: nothing in server/categoryAdmin.ts writes to `products`.
//   Hidden means "not offered for new listings"; the existing forty keep their
//   category and stay readable.
//
//   There is no Delete, anywhere. Archive retires a category; the id is
//   referenced by products, by import history and by past listings, and a
//   delete would take that with it. The server refuses one with a reason.
//
//   The slug cannot be edited. It is half the stable identity - the other half
//   is the id - and a movable slug makes every URL and stored reference a guess
//   about when it was written. It is shown, never in an input.
//
// The permission guard below hides controls the server would refuse. It is a
// courtesy, not the protection: every procedure this page calls is
// adminWith('marketplace.manage').

import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { toast } from 'sonner';
import {
  ShieldCheck, Loader2, ArrowLeft, Plus, Eye, EyeOff, Archive, RotateCcw, Tag, X, Search, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';

type Row = {
  id: number; slug: string; nameEn: string; nameAr: string;
  scope: 'PRODUCT' | 'SERVICE' | 'BOTH';
  status: 'active' | 'hidden' | 'archived';
  parentId: number | null; parentName: string | null; sortOrder: number; icon: string | null;
  productCount: number; activeProductCount: number;
  /** id AND text: a chip nobody can remove is a list, not a control. */
  aliases: { id: number; alias: string }[];
};

type SortKey = 'order' | 'name' | 'products' | 'status';

export default function AdminCategories() {
  const { lang, dir } = useLanguage();
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const t = (en: string, ar: string) => (lang === 'ar' ? ar : en);

  const { data: me } = trpc.admin.me.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const canManage = me?.permissions.includes('marketplace.manage') ?? false;

  const categories = trpc.admin.categories.useQuery(undefined, { enabled: canManage, retry: false });

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Row['status']>('all');
  const [scopeFilter, setScopeFilter] = useState<'all' | Row['scope']>('all');
  const [sort, setSort] = useState<SortKey>('order');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [confirming, setConfirming] = useState<{ row: Row; status: Row['status'] } | null>(null);
  const [aliasFor, setAliasFor] = useState<Row | null>(null);
  const [aliasDraft, setAliasDraft] = useState('');
  const blank = { slug: '', nameEn: '', nameAr: '', scope: 'PRODUCT' as Row['scope'], sortOrder: 0 };
  const [form, setForm] = useState(blank);

  const refresh = () => utils.admin.categories.invalidate();
  const onError = (error: { message: string }) => toast.error(error.message);

  const createCategory = trpc.admin.createCategory.useMutation({
    onSuccess: () => { toast.success(t('Category created', 'تم إنشاء الفئة')); setCreating(false); setForm(blank); void refresh(); },
    onError,
  });
  const updateCategory = trpc.admin.updateCategory.useMutation({
    onSuccess: () => { toast.success(t('Category updated', 'تم تحديث الفئة')); setEditing(null); void refresh(); },
    onError,
  });
  const setStatus = trpc.admin.setCategoryStatus.useMutation({
    onSuccess: () => { toast.success(t('Status changed', 'تم تغيير الحالة')); setConfirming(null); void refresh(); },
    onError,
  });
  const addAlias = trpc.admin.addCategoryAlias.useMutation({
    onSuccess: () => { toast.success(t('Alias added', 'تمت إضافة المرادف')); setAliasDraft(''); void refresh(); },
    onError,
  });
  const removeAlias = trpc.admin.removeCategoryAlias.useMutation({
    onSuccess: () => { toast.success(t('Alias removed', 'تمت إزالة المرادف')); void refresh(); },
    onError,
  });

  const rows: Row[] = (categories.data?.categories ?? []) as Row[];

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = rows.filter(row => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (scopeFilter !== 'all' && row.scope !== scopeFilter) return false;
      if (!needle) return true;
      // Aliases are searched too: an administrator investigating "why did
      // 'Pools' work" needs to find the row that answers to it.
      return [row.nameEn, row.nameAr, row.slug, ...row.aliases.map(a => a.alias)]
        .some(value => value.toLowerCase().includes(needle));
    });
    const byName = (row: Row) => (lang === 'ar' ? row.nameAr : row.nameEn);
    return [...filtered].sort((a, b) => {
      switch (sort) {
        case 'name': return byName(a).localeCompare(byName(b), lang === 'ar' ? 'ar' : 'en');
        case 'products': return b.productCount - a.productCount || a.sortOrder - b.sortOrder;
        case 'status': return a.status.localeCompare(b.status) || a.sortOrder - b.sortOrder;
        // Ties break on id so the order is stable between renders rather than
        // reshuffling every time the query refetches.
        default: return a.sortOrder - b.sortOrder || a.id - b.id;
      }
    });
  }, [rows, search, statusFilter, scopeFilter, sort, lang]);

  const STATUS_LABEL: Record<Row['status'], string> = {
    active: t('Active', 'نشطة'),
    hidden: t('Hidden', 'مخفية'),
    archived: t('Archived', 'مؤرشفة'),
  };
  const SCOPE_LABEL: Record<Row['scope'], string> = {
    PRODUCT: t('Products', 'منتجات'),
    SERVICE: t('Services', 'خدمات'),
    BOTH: t('Both', 'كلاهما'),
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center" dir={dir}><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  // A perfectly valid Sub-Admin who simply lacks this permission. Says so
  // plainly rather than pretending the page is missing.
  if (!canManage) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" dir={dir}>
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h1 className="text-xl font-bold">{t('Marketplace administrators only', 'لمشرفي السوق فقط')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('Managing the category taxonomy requires the marketplace permission.',
                 'إدارة شجرة الفئات تتطلب صلاحية السوق.')}
            </p>
            <Button variant="outline" className="mt-4" onClick={() => navigate('/admin')}>
              {t('Back to dashboard', 'العودة إلى لوحة التحكم')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20 px-4 py-8" dir={dir}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Button variant="ghost" size="sm" className="mb-2 gap-1.5" onClick={() => navigate('/admin')}>
              <ArrowLeft className={`h-4 w-4 ${dir === 'rtl' ? 'rotate-180' : ''}`} />{t('Dashboard', 'لوحة التحكم')}
            </Button>
            <h1 className="text-2xl font-bold">{t('Product categories', 'فئات المنتجات')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('One taxonomy. Every product listing, bulk upload and marketplace filter reads it.',
                 'شجرة واحدة. كل إدراج منتج ورفع جماعي ومرشّح في السوق يقرأ منها.')}
            </p>
          </div>
          <Button className="gap-2" data-testid="category-new" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />{t('New category', 'فئة جديدة')}
          </Button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className={`absolute top-2.5 h-4 w-4 text-muted-foreground ${dir === 'rtl' ? 'right-2.5' : 'left-2.5'}`} />
            <Input value={search} onChange={e => setSearch(e.target.value)} data-testid="category-search"
              className={dir === 'rtl' ? 'pr-8' : 'pl-8'}
              placeholder={t('Search name, slug or alias', 'ابحث بالاسم أو المعرّف أو المرادف')} />
          </div>
          <Select value={statusFilter} onValueChange={v => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger className="w-[150px]" data-testid="category-status-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('All statuses', 'كل الحالات')}</SelectItem>
              <SelectItem value="active">{STATUS_LABEL.active}</SelectItem>
              <SelectItem value="hidden">{STATUS_LABEL.hidden}</SelectItem>
              <SelectItem value="archived">{STATUS_LABEL.archived}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={scopeFilter} onValueChange={v => setScopeFilter(v as typeof scopeFilter)}>
            <SelectTrigger className="w-[150px]" data-testid="category-scope-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('All types', 'كل الأنواع')}</SelectItem>
              <SelectItem value="PRODUCT">{SCOPE_LABEL.PRODUCT}</SelectItem>
              <SelectItem value="SERVICE">{SCOPE_LABEL.SERVICE}</SelectItem>
              <SelectItem value="BOTH">{SCOPE_LABEL.BOTH}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={v => setSort(v as SortKey)}>
            <SelectTrigger className="w-[170px]" data-testid="category-sort"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="order">{t('Display order', 'ترتيب العرض')}</SelectItem>
              <SelectItem value="name">{t('Name', 'الاسم')}</SelectItem>
              <SelectItem value="products">{t('Most products', 'الأكثر منتجات')}</SelectItem>
              <SelectItem value="status">{t('Status', 'الحالة')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/*
          THREE DIFFERENT FACTS, THREE DIFFERENT SCREENS. A failed query is not
          an empty taxonomy, and an empty taxonomy is not a filter that matched
          nothing. Rendering any of them as "no categories" would be a lie the
          administrator acts on.
        */}
        {categories.isLoading ? (
          <Card><CardContent className="p-8 text-center" data-testid="category-loading">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent></Card>
        ) : categories.isError ? (
          <Card><CardContent className="p-8 text-center" data-testid="category-error">
            <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive" />
            <p className="font-medium">{t('The taxonomy could not be loaded', 'تعذّر تحميل شجرة الفئات')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{categories.error?.message}</p>
            <Button variant="outline" className="mt-4" onClick={() => void categories.refetch()}>
              {t('Try again', 'إعادة المحاولة')}
            </Button>
          </CardContent></Card>
        ) : rows.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground" data-testid="category-empty">
            {t('No categories yet.', 'لا توجد فئات بعد.')}
          </CardContent></Card>
        ) : visible.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground" data-testid="category-no-match">
            {t('No category matches these filters.', 'لا توجد فئة تطابق هذه المرشّحات.')}
          </CardContent></Card>
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {t(`${visible.length} of ${rows.length} categories`, `${visible.length} من ${rows.length} فئة`)}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {/* Wide content scrolls inside its own box; the page never does. */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="category-table">
                  <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="p-3 text-start">{t('Category', 'الفئة')}</th>
                      <th className="p-3 text-start">{t('Type', 'النوع')}</th>
                      <th className="p-3 text-start">{t('Status', 'الحالة')}</th>
                      <th className="p-3 text-start">{t('Products', 'المنتجات')}</th>
                      <th className="p-3 text-start">{t('Aliases', 'المرادفات')}</th>
                      <th className="p-3 text-end">{t('Actions', 'إجراءات')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(row => (
                      <tr key={row.id} className="border-b last:border-0" data-testid="category-row" data-slug={row.slug}>
                        <td className="p-3">
                          <div className="font-medium">{lang === 'ar' ? row.nameAr : row.nameEn}</div>
                          <div className="text-xs text-muted-foreground">
                            {lang === 'ar' ? row.nameEn : row.nameAr}
                            {' · '}
                            {/* The stable identity, shown and never editable. */}
                            <code data-testid="category-slug">{row.slug}</code>
                            {row.parentName ? ` · ${t('in', 'ضمن')} ${row.parentName}` : ''}
                          </div>
                        </td>
                        <td className="p-3">{SCOPE_LABEL[row.scope]}</td>
                        <td className="p-3">
                          <Badge data-testid="category-status"
                            variant={row.status === 'active' ? 'default' : row.status === 'hidden' ? 'secondary' : 'outline'}>
                            {STATUS_LABEL[row.status]}
                          </Badge>
                        </td>
                        <td className="p-3" data-testid="category-usage">
                          {/* Real counts. A zero here means zero. */}
                          <span className="font-medium">{row.productCount}</span>
                          {row.productCount > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {' '}({row.activeProductCount} {t('live', 'معروضة')})
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          {row.aliases.length === 0
                            ? <span className="text-xs text-muted-foreground">—</span>
                            : <span className="text-xs" data-testid="category-aliases">{row.aliases.map(a => a.alias).join(', ')}</span>}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button size="sm" variant="ghost" data-testid="category-edit"
                              onClick={() => setEditing(row)}>{t('Edit', 'تعديل')}</Button>
                            <Button size="sm" variant="ghost" className="gap-1" data-testid="category-aliases-open"
                              onClick={() => { setAliasFor(row); setAliasDraft(''); }}>
                              <Tag className="h-3.5 w-3.5" />{t('Aliases', 'المرادفات')}
                            </Button>
                            {row.status === 'active' ? (
                              <Button size="sm" variant="ghost" className="gap-1" data-testid="category-hide"
                                onClick={() => setConfirming({ row, status: 'hidden' })}>
                                <EyeOff className="h-3.5 w-3.5" />{t('Hide', 'إخفاء')}
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost" className="gap-1" data-testid="category-reactivate"
                                onClick={() => setConfirming({ row, status: 'active' })}>
                                <Eye className="h-3.5 w-3.5" />{t('Reactivate', 'إعادة التفعيل')}
                              </Button>
                            )}
                            {row.status !== 'archived' ? (
                              <Button size="sm" variant="ghost" className="gap-1" data-testid="category-archive"
                                onClick={() => setConfirming({ row, status: 'archived' })}>
                                <Archive className="h-3.5 w-3.5" />{t('Archive', 'أرشفة')}
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost" className="gap-1" data-testid="category-unarchive"
                                onClick={() => setConfirming({ row, status: 'hidden' })}>
                                <RotateCcw className="h-3.5 w-3.5" />{t('Unarchive', 'إلغاء الأرشفة')}
                              </Button>
                            )}
                            {/* Deliberately no Delete. See the header. */}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── create ─────────────────────────────────────────────────────── */}
      <Dialog open={creating} onOpenChange={open => { if (!open) setCreating(false); }}>
        <DialogContent dir={dir} data-testid="category-create-dialog">
          <DialogHeader><DialogTitle>{t('New category', 'فئة جديدة')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <label className="block text-sm">
              {t('English name', 'الاسم بالإنجليزية')}
              <Input className="mt-1" value={form.nameEn} data-testid="category-form-nameEn"
                onChange={e => setForm({ ...form, nameEn: e.target.value })} />
            </label>
            <label className="block text-sm">
              {/* Required, not optional. A category with no Arabic name renders
                  as a blank chip to half the market. */}
              {t('Arabic name', 'الاسم بالعربية')}
              <Input className="mt-1" value={form.nameAr} data-testid="category-form-nameAr" dir="rtl"
                onChange={e => setForm({ ...form, nameAr: e.target.value })} />
            </label>
            <label className="block text-sm">
              {t('Slug (permanent)', 'المعرّف (دائم)')}
              <Input className="mt-1" value={form.slug} data-testid="category-form-slug" dir="ltr"
                placeholder="waterproofing"
                onChange={e => setForm({ ...form, slug: e.target.value })} />
              <span className="mt-1 block text-xs text-muted-foreground">
                {t('Lowercase letters, numbers and hyphens. This cannot be changed later - it is how products and links refer to the category.',
                   'أحرف إنجليزية صغيرة وأرقام وشرطات. لا يمكن تغييره لاحقاً — فهو ما تشير به المنتجات والروابط إلى الفئة.')}
              </span>
            </label>
            <label className="block text-sm">
              {t('Type', 'النوع')}
              <Select value={form.scope} onValueChange={v => setForm({ ...form, scope: v as Row['scope'] })}>
                <SelectTrigger className="mt-1" data-testid="category-form-scope"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PRODUCT">{SCOPE_LABEL.PRODUCT}</SelectItem>
                  <SelectItem value="SERVICE">{SCOPE_LABEL.SERVICE}</SelectItem>
                  <SelectItem value="BOTH">{SCOPE_LABEL.BOTH}</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="block text-sm">
              {t('Display order', 'ترتيب العرض')}
              <Input className="mt-1" type="number" min={0} value={form.sortOrder} data-testid="category-form-order"
                onChange={e => setForm({ ...form, sortOrder: Number(e.target.value) || 0 })} />
            </label>
            <Button className="w-full" data-testid="category-create-submit"
              disabled={createCategory.isPending || !form.nameEn.trim() || !form.nameAr.trim() || !form.slug.trim()}
              onClick={() => createCategory.mutate(form)}>
              {createCategory.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t('Create', 'إنشاء')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── edit ───────────────────────────────────────────────────────── */}
      <Dialog open={editing !== null} onOpenChange={open => { if (!open) setEditing(null); }}>
        <DialogContent dir={dir} data-testid="category-edit-dialog">
          <DialogHeader><DialogTitle>{t('Edit category', 'تعديل الفئة')}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                {t(`Slug "${editing.slug}" is permanent. Renaming changes the label only - no product moves, and every existing link keeps working.`,
                   `المعرّف "${editing.slug}" دائم. إعادة التسمية تغيّر التسمية فقط — لا ينتقل أي منتج وتظل كل الروابط تعمل.`)}
              </p>
              <label className="block text-sm">
                {t('English name', 'الاسم بالإنجليزية')}
                <Input className="mt-1" value={editing.nameEn} data-testid="category-edit-nameEn"
                  onChange={e => setEditing({ ...editing, nameEn: e.target.value })} />
              </label>
              <label className="block text-sm">
                {t('Arabic name', 'الاسم بالعربية')}
                <Input className="mt-1" value={editing.nameAr} data-testid="category-edit-nameAr" dir="rtl"
                  onChange={e => setEditing({ ...editing, nameAr: e.target.value })} />
              </label>
              <label className="block text-sm">
                {t('Type', 'النوع')}
                <Select value={editing.scope} onValueChange={v => setEditing({ ...editing, scope: v as Row['scope'] })}>
                  <SelectTrigger className="mt-1" data-testid="category-edit-scope"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PRODUCT">{SCOPE_LABEL.PRODUCT}</SelectItem>
                    <SelectItem value="SERVICE">{SCOPE_LABEL.SERVICE}</SelectItem>
                    <SelectItem value="BOTH">{SCOPE_LABEL.BOTH}</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="block text-sm">
                {t('Display order', 'ترتيب العرض')}
                <Input className="mt-1" type="number" min={0} value={editing.sortOrder} data-testid="category-edit-order"
                  onChange={e => setEditing({ ...editing, sortOrder: Number(e.target.value) || 0 })} />
              </label>
              <Button className="w-full" data-testid="category-edit-submit" disabled={updateCategory.isPending}
                onClick={() => updateCategory.mutate({
                  id: editing.id, nameEn: editing.nameEn, nameAr: editing.nameAr,
                  scope: editing.scope, sortOrder: editing.sortOrder,
                })}>
                {updateCategory.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t('Save', 'حفظ')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── status change, with the real dependency count ───────────────── */}
      <Dialog open={confirming !== null} onOpenChange={open => { if (!open) setConfirming(null); }}>
        <DialogContent dir={dir} data-testid="category-confirm-dialog">
          <DialogHeader>
            <DialogTitle>
              {confirming?.status === 'active' ? t('Reactivate category', 'إعادة تفعيل الفئة')
                : confirming?.status === 'archived' ? t('Archive category', 'أرشفة الفئة')
                : t('Hide category', 'إخفاء الفئة')}
            </DialogTitle>
          </DialogHeader>
          {confirming && (
            <div className="space-y-3 text-sm">
              <p className="font-medium">{lang === 'ar' ? confirming.row.nameAr : confirming.row.nameEn}</p>
              {/*
                THE DEPENDENCY WARNING, with the REAL count. It is echoed back to
                the server as expectedProductCount, so if somebody lists forty
                more products between this dialog opening and the click, the
                change is refused rather than applied to a situation the
                administrator never saw.
              */}
              <p data-testid="category-dependency">
                {confirming.row.productCount === 0
                  ? t('No products use this category.', 'لا توجد منتجات تستخدم هذه الفئة.')
                  : t(`${confirming.row.productCount} product(s) use this category, ${confirming.row.activeProductCount} of them currently listed.`,
                       `${confirming.row.productCount} منتج يستخدم هذه الفئة، منها ${confirming.row.activeProductCount} معروضة حالياً.`)}
              </p>
              {confirming.status !== 'active' && confirming.row.productCount > 0 && (
                <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                  {t('Those products keep this category and stay readable. Nothing is moved or recategorised - this only stops NEW listings from choosing it.',
                     'تحتفظ تلك المنتجات بهذه الفئة وتظل قابلة للقراءة. لا يُنقل شيء ولا تُعاد تصنيفه — هذا يمنع الإدراجات الجديدة فقط من اختيارها.')}
                </p>
              )}
              <Button className="w-full" data-testid="category-confirm-submit" disabled={setStatus.isPending}
                onClick={() => setStatus.mutate({
                  id: confirming.row.id, status: confirming.status,
                  expectedProductCount: confirming.row.productCount,
                })}>
                {setStatus.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t('Confirm', 'تأكيد')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── aliases ────────────────────────────────────────────────────── */}
      <Dialog open={aliasFor !== null} onOpenChange={open => { if (!open) setAliasFor(null); }}>
        <DialogContent dir={dir} data-testid="category-alias-dialog">
          <DialogHeader>
            <DialogTitle>{t('Aliases', 'المرادفات')} — {aliasFor && (lang === 'ar' ? aliasFor.nameAr : aliasFor.nameEn)}</DialogTitle>
          </DialogHeader>
          {aliasFor && (
            <div className="space-y-3 text-sm">
              <p className="text-xs text-muted-foreground">
                {t('An alias lets an upload use a different wording for this category. It must point at exactly one category, so a name another category already answers to is refused.',
                   'يتيح المرادف استخدام صياغة أخرى لهذه الفئة عند الرفع. يجب أن يشير إلى فئة واحدة فقط، لذا يُرفض أي اسم تستجيب له فئة أخرى.')}
              </p>
              {aliasFor.aliases.length === 0 ? (
                <p className="text-muted-foreground" data-testid="category-alias-empty">
                  {t('No aliases.', 'لا توجد مرادفات.')}
                </p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {aliasFor.aliases.map(alias => (
                    <li key={alias.id} data-testid="category-alias"
                      className="flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 ps-2 pe-1 text-xs">
                      {alias.alias}
                      <button type="button" data-testid="category-alias-remove"
                        aria-label={t(`Remove alias ${alias.alias}`, `إزالة المرادف ${alias.alias}`)}
                        className="rounded-full p-0.5 hover:bg-destructive/10 disabled:opacity-50"
                        disabled={removeAlias.isPending}
                        onClick={() => removeAlias.mutate({ aliasId: alias.id })}>
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Input value={aliasDraft} data-testid="category-alias-input"
                  placeholder={t('e.g. Pools', 'مثال: حمامات سباحة')}
                  onChange={e => setAliasDraft(e.target.value)} />
                <Button data-testid="category-alias-add" disabled={addAlias.isPending || aliasDraft.trim().length < 2}
                  onClick={() => addAlias.mutate({ categoryId: aliasFor.id, alias: aliasDraft })}>
                  {addAlias.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
